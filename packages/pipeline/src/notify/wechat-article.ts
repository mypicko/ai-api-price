/**
 * 公众号日报文章：把当天的价格变动排成一篇给读者看的图文（与飞书运维日报不同，不含告警、隔离区）。
 * - 官方价排在第三方平台前面，同类按涨跌幅绝对值降序；每节最多 MAX_ROWS_PER_SECTION 条
 * - 下架只列官方；上下文变化、重新上架不写
 * - 不收录 OpenRouter 聚合价：它取最便宜那家服务商、天天波动（DEV §3.5 V9），各服务商的报价照常收录
 * - 手机上按「模型名一行、每个价格字段一行」上下排列，避免表格挤压换行
 * - 正文只用内联样式，不放脚本和链接（公众号正文外链点不了），网站地址放「阅读原文」
 * - 没有值得发的变动时返回 null，当天不生成草稿
 */
import { formatPct, formatPrice, type ChangeEvent, type Currency } from "@aipb/shared";
import { escapeHtml } from "./format";
import type { DailyReport } from "./types";

/** 公众号标题上限 64 字节，按 32 个字符截断 */
export const MAX_TITLE_LENGTH = 32;
/** 摘要上限 120 字节，按 54 个字符截断 */
export const MAX_DIGEST_LENGTH = 54;
export const MAX_ROWS_PER_SECTION = 8;

const OFFICIAL_PLATFORMS: ReadonlySet<string> = new Set(["official", "official-cn"]);
const EXCLUDED_PLATFORMS: ReadonlySet<string> = new Set(["openrouter"]);
const PRICE_FIELDS = ["input", "output"] as const;
const COLOR = {
  text: "#1f2328",
  muted: "#8a8f98",
  border: "#e5e7eb",
  down: "#15803d",
  up: "#dc2626",
  accent: "#2563eb",
} as const;

export interface PricePair {
  readonly input: number | null;
  readonly output: number | null;
  readonly currency: Currency;
}

export interface ArticleContext {
  readonly vendorName: (id: string) => string;
  readonly platformName: (id: string) => string;
  /** 新模型事件不带价格，从当天的报价里补 */
  readonly priceOf: (offeringId: string) => PricePair | null;
}

export interface WechatArticle {
  readonly title: string;
  readonly digest: string;
  readonly html: string;
  /** 「阅读原文」链接 */
  readonly contentSourceUrl: string;
}

const isOfficial = (e: ChangeEvent): boolean => OFFICIAL_PLATFORMS.has(e.platform);

/** 事件里涨跌幅绝对值最大的一项 */
function maxPct(e: ChangeEvent): number {
  return Math.max(0, ...e.fields.map((f) => Math.abs(f.pct ?? 0)));
}

function byImportance(a: ChangeEvent, b: ChangeEvent): number {
  return Number(isOfficial(b)) - Number(isOfficial(a)) || maxPct(b) - maxPct(a);
}

function pick(report: DailyReport, type: ChangeEvent["type"]): readonly ChangeEvent[] {
  return report.changes
    .filter((e) => e.type === type && !EXCLUDED_PLATFORMS.has(e.platform))
    .filter((e) => type !== "removed" || isOfficial(e))
    .toSorted(byImportance);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shortDate(date: string): string {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 标题主题：名字 + 动作 + 可选的涨跌幅 */
interface Headline {
  readonly name: string;
  readonly action: string;
  readonly pct: string | null;
}

function headline(
  down: readonly ChangeEvent[],
  up: readonly ChangeEvent[],
  added: readonly ChangeEvent[],
): Headline {
  const official = (list: readonly ChangeEvent[]) => list.find(isOfficial);
  const pctOf = (e: ChangeEvent) => formatPct(maxPct(e)).replace("+", "");
  const newModel = official(added);
  if (newModel) return { name: newModel.displayName, action: "上线", pct: null };
  const drop = official(down) ?? down[0];
  if (drop) return { name: drop.displayName, action: "降价", pct: pctOf(drop) };
  const rise = official(up) ?? up[0];
  if (rise) return { name: rise.displayName, action: "涨价", pct: pctOf(rise) };
  const first = added[0];
  return first
    ? { name: first.displayName, action: "上线", pct: null }
    : { name: "今日", action: "价格变动", pct: null };
}

/** 超长时先去掉涨跌幅，仍放不下再截断名字，不在数字中间截断 */
function buildTitle(date: string, h: Headline): string {
  const prefix = `AI 价格日报 ${shortDate(date)}｜`;
  const full = `${prefix}${h.name} ${h.action}${h.pct ? ` ${h.pct}` : ""}`;
  if (full.length <= MAX_TITLE_LENGTH) return full;
  const tail = ` ${h.action}`;
  const room = MAX_TITLE_LENGTH - prefix.length - tail.length;
  return `${prefix}${truncate(h.name, room)}${tail}`;
}

function where(e: ChangeEvent, ctx: ArticleContext): string {
  return `${ctx.vendorName(e.vendor)} · ${ctx.platformName(e.platform)}`;
}

function item(e: ChangeEvent, ctx: ArticleContext, lines: readonly string[]): string {
  const head = `<p style="margin:0;font-size:15px;line-height:1.5;"><strong>${escapeHtml(e.displayName)}</strong> <span style="font-size:12px;color:${COLOR.muted};">${escapeHtml(where(e, ctx))}</span></p>`;
  const body = lines
    .map((l) => `<p style="margin:2px 0 0;font-size:14px;line-height:1.6;">${l}</p>`)
    .join("");
  return `<section style="padding:10px 0;border-bottom:1px solid ${COLOR.border};">${head}${body}</section>`;
}

function changeLines(e: ChangeEvent): readonly string[] {
  const fields = e.fields.filter((f) => (PRICE_FIELDS as readonly string[]).includes(f.field));
  const shown = fields.length > 0 ? fields : e.fields.filter((f) => f.field !== "contextWindow");
  return shown.map((f) => {
    const label = f.field === "input" ? "输入" : f.field === "output" ? "输出" : "缓存";
    const color = (f.pct ?? 0) < 0 ? COLOR.down : COLOR.up;
    return `${label} <span style="color:${COLOR.muted};text-decoration:line-through;">${formatPrice(f.old, e.currency)}</span> → <strong>${formatPrice(f.new, e.currency)}</strong> <span style="color:${color};">${formatPct(f.pct)}</span>`;
  });
}

function newLines(e: ChangeEvent, ctx: ArticleContext): readonly string[] {
  const price = ctx.priceOf(e.offeringId);
  if (!price) return [`<span style="color:${COLOR.muted};">价格见网站</span>`];
  return [
    `输入 <strong>${formatPrice(price.input, price.currency)}</strong> · 输出 <strong>${formatPrice(price.output, price.currency)}</strong>`,
  ];
}

function section(
  title: string,
  events: readonly ChangeEvent[],
  render: (e: ChangeEvent) => string,
): string | null {
  if (events.length === 0) return null;
  const items = events.slice(0, MAX_ROWS_PER_SECTION).map(render).join("");
  const rest = events.length - MAX_ROWS_PER_SECTION;
  const more =
    rest > 0
      ? `<p style="font-size:13px;color:${COLOR.muted};margin:8px 0 0;">另有 ${rest} 条，点「阅读原文」查看全部</p>`
      : "";
  return `<h3 style="font-size:17px;margin:24px 0 4px;color:${COLOR.text};">${title}（${events.length}）</h3><section style="color:${COLOR.text};">${items}</section>${more}`;
}

function removedSection(events: readonly ChangeEvent[], ctx: ArticleContext): string | null {
  if (events.length === 0) return null;
  const names = events
    .slice(0, MAX_ROWS_PER_SECTION)
    .map((e) => `${escapeHtml(e.displayName)}（${escapeHtml(ctx.vendorName(e.vendor))}）`);
  const rest = events.length - MAX_ROWS_PER_SECTION;
  const tail = rest > 0 ? ` 等 ${events.length} 个` : "";
  return `<h3 style="font-size:17px;margin:24px 0 8px;color:${COLOR.text};">⛔ 官方下架（${events.length}）</h3><p style="font-size:14px;color:${COLOR.text};line-height:1.7;margin:0;">${names.join("、")}${tail}</p>`;
}

export function buildWechatArticle(report: DailyReport, ctx: ArticleContext): WechatArticle | null {
  const added = pick(report, "new_model");
  const down = pick(report, "price_down");
  const up = pick(report, "price_up");
  const removed = pick(report, "removed");
  if (added.length + down.length + up.length + removed.length === 0) return null;

  const counts = [
    down.length > 0 ? `降价 ${down.length}` : null,
    up.length > 0 ? `涨价 ${up.length}` : null,
    added.length > 0 ? `新模型 ${added.length}` : null,
    removed.length > 0 ? `官方下架 ${removed.length}` : null,
  ].filter((c): c is string => c !== null);
  const lead = `<p style="font-size:15px;color:${COLOR.text};line-height:1.7;margin:0 0 4px;">今天（${report.date}）共 ${counts.join("、")}。价格单位：每百万 tokens，按各平台原币种显示。</p>`;
  const body = [
    section("🆕 新模型", added, (e) => item(e, ctx, newLines(e, ctx))),
    section("🔻 降价", down, (e) => item(e, ctx, changeLines(e))),
    section("🔺 涨价", up, (e) => item(e, ctx, changeLines(e))),
    removedSection(removed, ctx),
  ].filter((s): s is string => s !== null);
  const footer = `<p style="font-size:12px;color:${COLOR.muted};line-height:1.7;margin:28px 0 0;">数据每天自动抓取自各厂商官网和平台公开报价，仅供参考，以官方页面为准。点「阅读原文」查看完整价格榜、价格走势和成本计算器。</p>`;

  return {
    title: buildTitle(report.date, headline(down, up, added)),
    digest: truncate(
      `${counts.join(" · ")}。每天自动更新的 AI 模型 API 价格变动`,
      MAX_DIGEST_LENGTH,
    ),
    html: `<section style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">${lead}${body.join("")}${footer}</section>`,
    contentSourceUrl: `${report.siteUrl}/changes`,
  };
}
