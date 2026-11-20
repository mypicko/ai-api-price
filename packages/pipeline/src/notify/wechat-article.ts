/**
 * 公众号日报文章：把当天的价格变动排成一篇给读者看的图文（与飞书运维日报不同，不含告警、隔离区）。
 * - 官方价排在第三方平台前面，同类按涨跌幅绝对值降序；每节最多 MAX_ROWS_PER_SECTION 条
 * - 下架只列官方；上下文变化、重新上架不写
 * - 不收录 OpenRouter 聚合价：它取最便宜那家服务商、天天波动（DEV §3.5 V9），各服务商的报价照常收录
 * - 版式：开头概览卡（各类数量）→ 各节色条标题 → 每条一张浅灰卡片，涨跌幅用带底色的标签；不用表格，手机上不挤
 * - 同一厂商同名的新模型（多平台同时上线）合并成一张卡，数量也按模型计
 * - 价格一律换算成人民币显示（开头注明汇率）；没有汇率时按原币种
 * - 正文只用内联样式，不放脚本和链接（公众号正文外链点不了），网站地址放「阅读原文」
 * - 没有值得发的变动时返回 null，当天不生成草稿
 */
import {
  convertCurrency,
  formatPct,
  formatPrice,
  type ChangeEvent,
  type Currency,
} from "@aipb/shared";
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
  card: "#f6f7f9",
  border: "#e5e7eb",
  new: "#2563eb",
  newBg: "#eaf1fe",
  down: "#16a34a",
  downBg: "#e7f6ec",
  up: "#dc2626",
  upBg: "#fdecec",
  removed: "#6b7280",
  removedBg: "#eef0f3",
} as const;

export interface PricePair {
  readonly input: number | null;
  readonly output: number | null;
  readonly currency: Currency;
}

export interface ArticleContext {
  /** 1 美元兑多少人民币；null = 没有汇率，按原币种显示 */
  readonly usdCny: number | null;
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

/** 标题主题：名字 + 厂商 + 动作 + 可选的涨跌幅 */
interface Headline {
  readonly name: string;
  readonly vendor: string | null;
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
  const of = (e: ChangeEvent, action: string, pct: string | null): Headline => ({
    name: e.displayName,
    vendor: e.vendor,
    action,
    pct,
  });
  const newModel = official(added);
  if (newModel) return of(newModel, "上线", null);
  const drop = official(down) ?? down[0];
  if (drop) return of(drop, "降价", pctOf(drop));
  const rise = official(up) ?? up[0];
  if (rise) return of(rise, "涨价", pctOf(rise));
  const first = added[0];
  return first
    ? of(first, "上线", null)
    : { name: "今日", vendor: null, action: "价格变动", pct: null };
}

/**
 * 按顺序取第一个放得下的写法，不把名字截成半截：
 * 名字 + 涨跌幅 → 名字 → 厂商 + 涨跌幅 → 厂商 → 通用说法（新模型上线 / 模型降价）
 */
function buildTitle(date: string, h: Headline, vendorName: (id: string) => string): string {
  const prefix = `AI 价格日报 ${shortDate(date)}｜`;
  const pct = h.pct ? ` ${h.pct}` : "";
  const isNew = h.action === "上线";
  const vendor = h.vendor ? vendorName(h.vendor) : null;
  const byVendor = vendor ? (isNew ? `${vendor} 新模型上线` : `${vendor} ${h.action}`) : null;
  const candidates = [
    `${h.name} ${h.action}${pct}`,
    `${h.name} ${h.action}`,
    ...(byVendor ? [`${byVendor}${isNew ? "" : pct}`, byVendor] : []),
    isNew ? "新模型上线" : `模型${h.action}`,
  ];
  const fits = candidates.find((c) => prefix.length + c.length <= MAX_TITLE_LENGTH);
  return `${prefix}${fits ?? candidates[candidates.length - 1]}`;
}

/** 正文排版：只用内联样式；块用 section、文字用 p / span（公众号会过滤 class、style 标签和 flex 以外的大部分布局） */
const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif";

const pill = (text: string, color: string, bg: string): string =>
  `<span style="display:inline-block;padding:0 6px;margin-left:6px;border-radius:4px;font-size:12px;line-height:20px;font-weight:600;color:${color};background:${bg};">${text}</span>`;

function card(name: string, meta: string, lines: readonly string[]): string {
  const body = lines
    .map(
      (l) =>
        `<p style="margin:6px 0 0;font-size:14px;line-height:1.6;color:${COLOR.text};">${l}</p>`,
    )
    .join("");
  return `<section style="background:${COLOR.card};border-radius:10px;padding:12px 14px;margin:0 0 10px;"><p style="margin:0;font-size:16px;line-height:1.4;font-weight:600;color:${COLOR.text};">${escapeHtml(name)}</p><p style="margin:2px 0 0;font-size:12px;line-height:1.5;color:${COLOR.muted};">${escapeHtml(meta)}</p>${body}</section>`;
}

function heading(title: string, count: number, color: string, bg: string): string {
  return `<section style="margin:28px 0 12px;"><span style="display:inline-block;width:4px;height:18px;border-radius:2px;background:${color};vertical-align:middle;margin-right:8px;"></span><span style="font-size:18px;font-weight:700;color:${COLOR.text};vertical-align:middle;">${title}</span>${pill(String(count), color, bg)}</section>`;
}

/** 有汇率时换算成人民币，否则按原币种 */
function money(value: number | null, currency: Currency, usdCny: number | null): string {
  if (usdCny === null) return formatPrice(value, currency);
  return formatPrice(convertCurrency(value, currency, "CNY", usdCny), "CNY");
}

const muted = (text: string): string => `<span style="color:${COLOR.muted};">${text}</span>`;

function changeLines(e: ChangeEvent, usdCny: number | null): readonly string[] {
  const fields = e.fields.filter((f) => (PRICE_FIELDS as readonly string[]).includes(f.field));
  const shown = fields.length > 0 ? fields : e.fields.filter((f) => f.field !== "contextWindow");
  return shown.map((f) => {
    const label = f.field === "input" ? "输入" : f.field === "output" ? "输出" : "缓存";
    const down = (f.pct ?? 0) < 0;
    return `${muted(label)}&nbsp; <span style="color:${COLOR.muted};text-decoration:line-through;">${money(f.old, e.currency, usdCny)}</span> → <strong>${money(f.new, e.currency, usdCny)}</strong>${pill(formatPct(f.pct), down ? COLOR.down : COLOR.up, down ? COLOR.downBg : COLOR.upBg)}`;
  });
}

function priceText(price: PricePair | null, usdCny: number | null): string {
  if (!price) return muted("价格见网站");
  return `${muted("输入")} <strong>${money(price.input, price.currency, usdCny)}</strong>&nbsp;&nbsp;${muted("输出")} <strong>${money(price.output, price.currency, usdCny)}</strong>`;
}

/** 同一厂商、同名的新模型合并成一组（多个平台同时上线） */
interface ModelGroup {
  readonly first: ChangeEvent;
  readonly events: readonly ChangeEvent[];
}

function groupModels(events: readonly ChangeEvent[]): readonly ModelGroup[] {
  const groups = new Map<string, ChangeEvent[]>();
  for (const e of events) {
    const key = `${e.vendor}|${e.displayName}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.values()].map((list) => ({ first: list[0] as ChangeEvent, events: list }));
}

/** 价格相同的平台写在一起；全部相同时平台列在名字下面，只写一行价格 */
function newModelCard(g: ModelGroup, ctx: ArticleContext): string {
  const byPrice = new Map<string, { price: PricePair | null; platforms: string[] }>();
  for (const e of g.events) {
    const price = ctx.priceOf(e.offeringId);
    const key = JSON.stringify(price);
    const entry = byPrice.get(key) ?? { price, platforms: [] };
    byPrice.set(key, { ...entry, platforms: [...entry.platforms, ctx.platformName(e.platform)] });
  }
  const vendor = ctx.vendorName(g.first.vendor);
  const rows = [...byPrice.values()];
  const [only] = rows;
  if (rows.length === 1 && only)
    return card(g.first.displayName, `${vendor} · ${only.platforms.join("、")}`, [
      priceText(only.price, ctx.usdCny),
    ]);
  return card(
    g.first.displayName,
    vendor,
    rows.map((r) => `${escapeHtml(r.platforms.join("、"))}：${priceText(r.price, ctx.usdCny)}`),
  );
}

function changeCard(e: ChangeEvent, ctx: ArticleContext): string {
  return card(
    e.displayName,
    `${ctx.vendorName(e.vendor)} · ${ctx.platformName(e.platform)}`,
    changeLines(e, ctx.usdCny),
  );
}

function moreNote(rest: number, unit: string): string {
  return rest > 0
    ? `<p style="font-size:13px;color:${COLOR.muted};margin:4px 0 0;text-align:center;">另有 ${rest} ${unit}，点「阅读原文」查看全部</p>`
    : "";
}

function cards(items: readonly string[], unit: string): string {
  return `${items.slice(0, MAX_ROWS_PER_SECTION).join("")}${moreNote(items.length - MAX_ROWS_PER_SECTION, unit)}`;
}

function removedSection(events: readonly ChangeEvent[], ctx: ArticleContext): string {
  const chips = events
    .slice(0, MAX_ROWS_PER_SECTION)
    .map(
      (e) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:2px 8px;border-radius:4px;font-size:13px;line-height:1.6;color:${COLOR.removed};background:${COLOR.removedBg};">${escapeHtml(e.displayName)} · ${escapeHtml(ctx.vendorName(e.vendor))}</span>`,
    )
    .join("");
  return `<section>${chips}</section>${moreNote(events.length - MAX_ROWS_PER_SECTION, "个")}`;
}

interface Stat {
  readonly label: string;
  readonly count: number;
  readonly color: string;
}

function unitNote(usdCny: number | null): string {
  return usdCny === null
    ? "价格单位：每百万 tokens，按各平台原币种显示。"
    : `价格单位：人民币 / 每百万 tokens；美元报价按 1 美元 ≈ ${usdCny.toFixed(2)} 元换算。`;
}

function overview(date: string, stats: readonly Stat[], usdCny: number | null): string {
  const [, month = "", day = ""] = date.split("-");
  const cells = stats
    .filter((s) => s.count > 0)
    .map(
      (s) =>
        `<section style="flex:1;text-align:center;"><p style="margin:0;font-size:26px;line-height:1.2;font-weight:700;color:${s.color};">${s.count}</p><p style="margin:2px 0 0;font-size:12px;color:${COLOR.muted};">${s.label}</p></section>`,
    )
    .join("");
  return `<section style="background:linear-gradient(135deg,#eef4ff 0%,#f8faff 100%);border-radius:12px;padding:16px 16px 14px;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:${COLOR.new};font-weight:600;">AI 模型 API 价格日报</p><p style="margin:4px 0 14px;font-size:20px;font-weight:700;color:${COLOR.text};">${Number(month)} 月 ${Number(day)} 日</p><section style="display:flex;">${cells}</section></section><p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${COLOR.muted};">${unitNote(usdCny)}</p>`;
}

function footer(): string {
  return `<section style="margin:32px 0 0;padding:14px 16px;border-radius:10px;border:1px solid ${COLOR.border};"><p style="margin:0;font-size:14px;line-height:1.6;color:${COLOR.text};font-weight:600;">查看完整价格榜</p><p style="margin:4px 0 0;font-size:13px;line-height:1.7;color:${COLOR.muted};">点左下角「阅读原文」，看全部模型的价格对比、价格走势和成本计算器。</p></section><p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:${COLOR.muted};">数据每天自动抓取自各厂商官网和平台公开报价，仅供参考，以官方页面为准。</p>`;
}

export function buildWechatArticle(report: DailyReport, ctx: ArticleContext): WechatArticle | null {
  const added = pick(report, "new_model");
  const down = pick(report, "price_down");
  const up = pick(report, "price_up");
  const removed = pick(report, "removed");
  if (added.length + down.length + up.length + removed.length === 0) return null;

  const models = groupModels(added);
  const stats: readonly Stat[] = [
    { label: "新模型", count: models.length, color: COLOR.new },
    { label: "降价", count: down.length, color: COLOR.down },
    { label: "涨价", count: up.length, color: COLOR.up },
    { label: "官方下架", count: removed.length, color: COLOR.removed },
  ];
  const counts = stats.filter((s) => s.count > 0).map((s) => `${s.label} ${s.count}`);
  const body = [
    models.length > 0
      ? heading("新模型", models.length, COLOR.new, COLOR.newBg) +
        cards(
          models.map((g) => newModelCard(g, ctx)),
          "个",
        )
      : "",
    down.length > 0
      ? heading("降价", down.length, COLOR.down, COLOR.downBg) +
        cards(
          down.map((e) => changeCard(e, ctx)),
          "条",
        )
      : "",
    up.length > 0
      ? heading("涨价", up.length, COLOR.up, COLOR.upBg) +
        cards(
          up.map((e) => changeCard(e, ctx)),
          "条",
        )
      : "",
    removed.length > 0
      ? heading("官方下架", removed.length, COLOR.removed, COLOR.removedBg) +
        removedSection(removed, ctx)
      : "",
  ].join("");

  return {
    title: buildTitle(report.date, headline(down, up, added), ctx.vendorName),
    digest: truncate(
      `${counts.join(" · ")}。每天自动更新的 AI 模型 API 价格变动`,
      MAX_DIGEST_LENGTH,
    ),
    html: `<section style="font-family:${FONT};color:${COLOR.text};">${overview(report.date, stats, ctx.usdCny)}${body}${footer()}</section>`,
    contentSourceUrl: `${report.siteUrl}/changes/wechat/`,
  };
}
