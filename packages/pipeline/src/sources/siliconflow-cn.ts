/**
 * 硅基流动国内站人民币价格（平台 siliconflow-cn；静态 HTML，服务端渲染）。
 * 入口：https://www.siliconflow.cn/pricing
 *   2026-10-18 境外网络连不上；2026-11-20 实测 GitHub 托管运行器可以访问。原来由 models.dev 社区数据（美元换算）补充，
 *   现在以本抓取器为准（优先级更高），models.dev 只补本页没有的模型。
 * 结构要点（div 网格，不是 <table>）：
 * - 分类标题是只含文字的元素：「对话模型」「生图模型」「语音模型」「视频模型」，只收「对话模型」
 * - 每个模型一行：第一格是 <a href=".../models?target=…" title="组织/模型名">，后面的价格格子按「输入、输出、缓存」三个一组，
 *   每格是「<span>时段或分档说明</span><span>¥ 2.00</span>」；价格可能是「免费」或「-」
 * - 有两组时：按时段分（「费用发生时段: 0点～2点/8点～24点」和「2点～8点」，先后不固定）取高峰组，闲时写进 notes；
 *   按输入长度分（「输入 [0, 128k)」「输入 [128k, +∞)」）生成阶梯价
 * - 跳过：没有输出价的向量 / 重排序模型（与对话模型在同一张表里），以及「Pro/组织/模型」付费加速版（models.dev 同样不收）
 * - 厂商取组织名、模型名取斜杠后部分、展示名用完整的「组织/模型名」，与 models.dev 的硅基流动国内站一致，报价 ID 不变
 * 最后核对：2026-11-20
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  type HtmlElement,
  joinNotes,
  normalizeSpace,
  parseTokenRange,
  type TokenRange,
} from "./parse-price";
import type { Source } from "./types";

export const SILICONFLOW_CN_URL = "https://www.siliconflow.cn/pricing";
const SOURCE_ID = "siliconflow-cn";
const CHAT_SECTION = "对话模型";
const SECTIONS: ReadonlySet<string> = new Set(["对话模型", "生图模型", "语音模型", "视频模型"]);
const MODEL_LINK = "models?target=";
const PERIOD = /费用发生时段[:：]\s*(.+)/;
const ACCELERATED = /^Pro\//;

interface Group {
  readonly label: string;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
}

/** 「¥ 2.00」→ 2；「免费」→ 0；「-」→ null */
function priceOf(text: string): number | null {
  const clean = normalizeSpace(text);
  if (clean === "免费") return 0;
  const match = /^[¥￥]\s*(\d+(?:\.\d+)?)$/.exec(clean);
  return match?.[1] ? Number(match[1]) : null;
}

/** 价格格子按 3 个一组：输入、输出、缓存 */
function groupsOf($: cheerio.CheerioAPI, row: cheerio.Cheerio<HtmlElement>): readonly Group[] {
  const cells = row
    .children()
    .slice(1)
    .toArray()
    .map((cell) => {
      const spans = $(cell).children("span");
      return { label: normalizeSpace(spans.first().text()), price: priceOf(spans.last().text()) };
    });
  const groups: Group[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    const [input, output, cache] = [cells[i], cells[i + 1], cells[i + 2]];
    groups.push({
      label: input?.label ?? "",
      input: input?.price ?? null,
      output: output?.price ?? null,
      cacheRead: cache?.price ?? null,
    });
  }
  return groups;
}

/** 「输入 [0, 128k)」→ 0~128000；「输入 [128k, +∞)」→ 128000~不限 */
function rangeOf(label: string): TokenRange | null {
  return parseTokenRange(label.replace(/^输入\s*/, "").replace(/\+?∞/, ""));
}

function toOffering(id: string, groups: readonly Group[]): RawOffering | null {
  const slash = id.indexOf("/");
  if (slash <= 0) return null;
  const periods = groups.filter((g) => PERIOD.test(g.label));
  const ranged = groups.filter((g) => rangeOf(g.label) !== null);
  // 分时段：高峰组价格更高；其他情况取第一组
  const standard =
    periods.length > 1
      ? periods.reduce((a, b) => ((b.input ?? 0) > (a.input ?? 0) ? b : a))
      : groups[0];
  if (!standard || (standard.input === null && standard.output === null)) return null;
  const offPeak = periods.filter((g) => g !== standard);
  const tiers: readonly RawTier[] =
    ranged.length > 1
      ? ranged.map((g) => ({
          minInputTokens: rangeOf(g.label)?.min ?? 0,
          maxInputTokens: rangeOf(g.label)?.max ?? null,
          input: g.input,
          output: g.output,
        }))
      : [];
  const period = (g: Group): string => PERIOD.exec(g.label)?.[1] ?? g.label;
  const notes =
    offPeak.length > 0
      ? joinNotes([
          `表中为 ${period(standard)} 的价格`,
          ...offPeak.map((g) => `${period(g)}：输入 ¥${g.input ?? "—"}、输出 ¥${g.output ?? "—"}`),
        ])
      : undefined;
  return {
    vendorHint: id.slice(0, slash),
    modelName: id.slice(slash + 1),
    displayName: id,
    currency: "CNY",
    unit: "per_1m",
    input: standard.input,
    output: standard.output,
    ...(standard.cacheRead === null ? {} : { cacheRead: standard.cacheRead }),
    ...(tiers.length > 0 ? { tiers: [...tiers] } : {}),
    sourceUrl: SILICONFLOW_CN_URL,
    ...(notes ? { notes } : {}),
  };
}

export function parseSiliconflowCnHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  const offerings = new Map<string, RawOffering>();
  let section = "";
  $("body *").each((_, el) => {
    const node = $(el);
    const text = node.children().length === 0 ? normalizeSpace(node.text()) : "";
    if (SECTIONS.has(text)) {
      section = text;
      return;
    }
    if (section !== CHAT_SECTION) return;
    const link = node.children("div").first().children(`a[href*="${MODEL_LINK}"][title]`);
    const id = normalizeSpace(link.attr("title") ?? "");
    if (id === "" || ACCELERATED.test(id) || offerings.has(id)) return;
    const groups = groupsOf($, node);
    // 向量 / 重排序模型只有输入价，不是对话模型
    if (groups.every((g) => g.output === null)) return;
    const offering = toOffering(id, groups);
    if (offering) offerings.set(id, offering);
    else
      logger?.warn("siliconflow-cn：跳过没有价格的模型", {
        sourceId: SOURCE_ID,
        code: "W2003",
        model: id,
      });
  });
  if (offerings.size === 0)
    throw new PipelineError("E2001", "siliconflow-cn：找不到「对话模型」价格表", {
      sourceId: SOURCE_ID,
    });
  return [...offerings.values()];
}

export const siliconflowCnSource: Source = {
  id: SOURCE_ID,
  platform: "siliconflow-cn",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(SILICONFLOW_CN_URL, { timeoutMs: 30_000 });
    const offerings = parseSiliconflowCnHtml(html, ctx.logger);
    ctx.logger.info("siliconflow-cn 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
