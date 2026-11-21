/**
 * 百度普通收录 API 推送（DEV_DOCUMENT §3.29）：国内站发布后，把网址主动提交给百度，加快收录。
 * - 接口：POST http://data.zz.baidu.com/urls?site=<站点>&token=<令牌>，正文每行一个网址（text/plain）
 * - 每天额度有限（新站通常 10 条，BAIDU_PUSH_LIMIT 可调），所以先推最有价值的：
 *   首页 → 价格变动页 → 当天有价格变动的模型页（中文）→ 其余页面按日期轮换（中文在前），几周下来覆盖全站
 * - 网址取自线上的 sitemap.xml，保证推送的都是已经发布、能打开的页面
 * - 当天额度已用完（over quota）只提示、不算失败
 * - 令牌 BAIDU_PUSH_TOKEN 是密钥：只放 GitHub Secrets，不写进日志和报错信息
 */
import { PipelineError } from "../core/errors";

export const BAIDU_PUSH_ENDPOINT = "http://data.zz.baidu.com/urls";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 2000;
const TIMEOUT_MS = 20_000;
const PRIORITY_PATHS = ["/", "/changes/"] as const;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** sitemap 里的 <loc>（不取 xhtml:link 的 hreflang 链接） */
export function parseSitemapLocs(xml: string): readonly string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].flatMap((m) => (m[1] ? [m[1]] : []));
}

export interface PickOptions {
  readonly locs: readonly string[];
  /** 当天有价格变动的模型 slug，如 "minimax/minimax-m2.7" */
  readonly changedSlugs: readonly string[];
  /** 轮换起点（按日期递增） */
  readonly dayIndex: number;
  readonly limit: number;
}

const isEnglish = (url: string): boolean => new URL(url).pathname.startsWith("/en/");

export function pickUrls(opts: PickOptions): readonly string[] {
  const available = new Set(opts.locs);
  const origin = opts.locs[0] ? new URL(opts.locs[0]).origin : "";
  const priority = [
    ...PRIORITY_PATHS.map((p) => `${origin}${p}`),
    ...opts.changedSlugs.map((slug) => `${origin}/models/${slug}/`),
  ].filter((u) => available.has(u));
  const chosen = new Set(priority);
  const rest = [
    ...opts.locs.filter((u) => !isEnglish(u)),
    ...opts.locs.filter((u) => isEnglish(u)),
  ].filter((u) => !chosen.has(u));
  const room = Math.max(0, opts.limit - chosen.size);
  const start = rest.length === 0 ? 0 : (opts.dayIndex * room) % rest.length;
  const rotated = [...rest.slice(start), ...rest.slice(0, start)].slice(0, room);
  return [...chosen, ...rotated].slice(0, opts.limit);
}

export interface PushResult {
  readonly success: number;
  readonly remain: number;
}

export async function pushToBaidu(opts: {
  readonly site: string;
  readonly token: string;
  readonly urls: readonly string[];
  readonly fetchImpl?: FetchLike;
}): Promise<PushResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!/^[A-Za-z0-9]{1,64}$/.test(opts.token))
    throw new PipelineError("E5001", "百度推送：BAIDU_PUSH_TOKEN 格式不对（应只含字母和数字）");
  // 与百度后台「API提交」给的调用地址完全一致：site 带协议、不做 URL 编码（编码后会报 site init fail）
  const url = `${BAIDU_PUSH_ENDPOINT}?site=${opts.site}&token=${opts.token}`;
  let body: { success?: number; remain?: number; error?: number; message?: string };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: opts.urls.join("\n"),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    body = (await response.json()) as typeof body;
  } catch (error) {
    // 不把 cause 带出去：原始错误里可能有含令牌的请求地址
    const reason = error instanceof Error ? error.name : "未知错误";
    throw new PipelineError("E5001", `百度推送：请求失败（${reason}）`);
  }
  // 当天额度已用完（例如同一天手动重跑过）：不算失败
  if (body.message === "over quota") return { success: 0, remain: 0 };
  if (typeof body.success !== "number")
    throw new PipelineError(
      "E5001",
      `百度推送：接口返回错误 ${body.error ?? "?"}：${body.message ?? "无说明"}`,
    );
  return { success: body.success, remain: body.remain ?? 0 };
}

export type RunResult =
  | { readonly status: "skipped"; readonly reason: string }
  | {
      readonly status: "pushed";
      readonly urls: readonly string[];
      readonly success: number;
      readonly remain: number;
    };

function parseLimit(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

/** 日期 → 天数（轮换起点） */
const dayIndexOf = (date: string): number =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

export async function runBaiduPush(opts: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly changedSlugs: readonly string[];
  /** 北京时间 YYYY-MM-DD */
  readonly date: string;
  readonly fetchImpl?: FetchLike;
}): Promise<RunResult> {
  const token = opts.env["BAIDU_PUSH_TOKEN"]?.trim();
  const site = (opts.env["CN_SITE_URL"]?.trim() ?? "").replace(/\/+$/, "");
  if (!token) return { status: "skipped", reason: "没有配置 BAIDU_PUSH_TOKEN" };
  if (!/^https?:\/\/[^/\s]+$/.test(site))
    return { status: "skipped", reason: "CN_SITE_URL 不是站点根地址（如 https://promptso.top）" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sitemapUrl = `${site}/sitemap.xml`;
  let xml: string;
  try {
    const response = await fetchImpl(sitemapUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    xml = await response.text();
  } catch (error) {
    throw new PipelineError("E5001", `百度推送：读取 ${sitemapUrl} 失败`, { cause: error });
  }
  const urls = pickUrls({
    locs: parseSitemapLocs(xml),
    changedSlugs: opts.changedSlugs,
    dayIndex: dayIndexOf(opts.date),
    limit: parseLimit(opts.env["BAIDU_PUSH_LIMIT"]),
  });
  if (urls.length === 0) return { status: "skipped", reason: "sitemap 里没有网址" };
  const result = await pushToBaidu({ site, token, urls, fetchImpl });
  return { status: "pushed", urls, ...result };
}
