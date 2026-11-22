/**
 * 公众号周报（DEV_DOCUMENT §3.31）：每周一汇总上周一到上周日的价格变动，外加「国内最便宜的大模型」排行。
 * - 同一报价一周内多次变价合并成「周初价 → 周末价」，来回变动抵消的不算
 * - 新模型只列官方（国内 / 国际）首发，同名多平台合并；涨降价官方在前，按幅度排序；不收 OpenRouter 聚合价
 * - 排行：国内站官方（official-cn）、在售、文本、非免费、人民币报价，按 (3×输入 + 输出) / 4 的混合价升序；
 *   去掉 OCR / 翻译 / 向量 / 语音等专用模型，带日期的快照版与主版本同价时只留主版本
 * - 版式、配色、卡片与日报共用（wechat-article.ts）；一周没有变动也照常出（只有排行），排行也为空时返回 null
 */
import { formatPrice, type ChangeEvent, type ChangeField, type Offering } from "@aipb/shared";
import { escapeHtml } from "./format";
import {
  type ArticleContext,
  byImportance,
  cards,
  changeCard,
  COLOR,
  EXCLUDED_PLATFORMS,
  FONT,
  footer,
  groupModels,
  heading,
  isOfficial,
  MAX_DIGEST_LENGTH,
  MAX_TITLE_LENGTH,
  maxPct,
  muted,
  newModelCard,
  shortDate,
  truncate,
  unitNote,
  type WechatArticle,
} from "./wechat-article";

export const RANKING_SIZE = 10;
const DAY_MS = 86_400_000;
const PRICE_FIELDS: ReadonlySet<string> = new Set(["input", "output", "cacheRead", "cacheWrite"]);

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** 运行日（北京时间）→ 上周一到上周日 */
export function weekRange(runDate: string): { readonly start: string; readonly end: string } {
  const weekday = new Date(`${runDate}T00:00:00Z`).getUTCDay(); // 0 = 周日
  const sinceMonday = (weekday + 6) % 7;
  const start = addDays(runDate, -sinceMonday - 7);
  return { start, end: addDays(start, 6) };
}

/** 合并一周内同一报价的多次变价：每个字段取最早的旧值和最晚的新值 */
export function mergeWeekChanges(events: readonly ChangeEvent[]): readonly ChangeEvent[] {
  const byOffering = new Map<string, ChangeEvent[]>();
  for (const e of events.filter((x) => x.type === "price_down" || x.type === "price_up"))
    byOffering.set(e.offeringId, [...(byOffering.get(e.offeringId) ?? []), e]);
  return [...byOffering.values()].flatMap((list) => {
    const sorted = list.toSorted((a, b) => a.id.localeCompare(b.id));
    const fields = new Map<string, ChangeField>();
    for (const e of sorted)
      for (const fd of e.fields.filter((x) => PRICE_FIELDS.has(x.field))) {
        const prev = fields.get(fd.field);
        fields.set(fd.field, { ...fd, old: prev ? prev.old : fd.old });
      }
    const net = [...fields.values()]
      .filter((fd) => fd.old !== fd.new)
      .map((fd) => ({
        ...fd,
        pct: fd.old && fd.new !== null ? (fd.new - fd.old) / fd.old : null,
      }));
    const last = sorted[sorted.length - 1];
    if (!last || net.length === 0) return [];
    const main = net.find((fd) => fd.field === "input") ?? net[0];
    const type = (main?.new ?? 0) < (main?.old ?? 0) ? "price_down" : "price_up";
    return [{ ...last, type, fields: net }];
  });
}

const blended = (o: Offering): number => ((o.input ?? 0) * 3 + (o.output ?? 0)) / 4;
/** OCR、翻译、向量、语音等专用模型不进「大模型」排行 */
const SPECIALIZED =
  /ocr|translat|(^|[-_ ])mt\d*([-_ ]|$)|embed|rerank|analysis|tts|asr|audio|speech/i;
/** 带日期的快照版（「Qwen Flash (2025-07-28)」）和 -latest 别名与主版本同价时只留主版本 */
const baseName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "")
    .replace(/[-_]\d{4}-?\d{2}-?\d{2}$/, "")
    .replace(/[-_ ]latest$/, "")
    .replace(/[\s_]+/g, "-");

export function cheapestCn(
  offerings: readonly Offering[],
  size = RANKING_SIZE,
): readonly Offering[] {
  return offerings
    .filter(
      (o) =>
        o.platform === "official-cn" &&
        o.status === "active" &&
        !o.stale &&
        !o.isFree &&
        o.currency === "CNY" &&
        o.modalities.includes("text") &&
        (o.input ?? 0) > 0 &&
        (o.output ?? 0) > 0,
    )
    .filter((o) => !SPECIALIZED.test(`${o.model} ${o.displayName}`))
    .toSorted((a, b) => blended(a) - blended(b) || a.displayName.length - b.displayName.length)
    .filter((o, i, list) => {
      const key = `${o.vendor}|${baseName(o.displayName)}|${o.input}|${o.output}`;
      return (
        list.findIndex(
          (x) => `${x.vendor}|${baseName(x.displayName)}|${x.input}|${x.output}` === key,
        ) === i
      );
    })
    .slice(0, size);
}

function rankingSection(list: readonly Offering[], ctx: ArticleContext): string {
  const rows = list
    .map(
      (o, i) =>
        `<p style="margin:0;padding:9px 0;border-bottom:1px solid ${COLOR.border};font-size:14px;line-height:1.5;color:${COLOR.text};"><strong style="display:inline-block;width:22px;color:${i < 3 ? COLOR.up : COLOR.muted};">${i + 1}</strong>${escapeHtml(o.displayName)} ${muted(`· ${escapeHtml(ctx.vendorName(o.vendor))}`)}<br/><span style="display:inline-block;width:22px;"></span>${muted("输入")} <strong>${formatPrice(o.input, "CNY")}</strong>&nbsp;&nbsp;${muted("输出")} <strong>${formatPrice(o.output, "CNY")}</strong></p>`,
    )
    .join("");
  return `${heading("国内最便宜的大模型", list.length, COLOR.new, COLOR.newBg)}<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${COLOR.muted};">各厂商国内站官方价，按「3 份输入 + 1 份输出」的混合价从低到高；不含免费模型。</p><section>${rows}</section>`;
}

export interface WeeklyInput {
  readonly start: string;
  readonly end: string;
  readonly events: readonly ChangeEvent[];
  readonly offerings: readonly Offering[];
  readonly siteUrl: string;
}

function weeklyTitle(
  range: string,
  added: readonly ChangeEvent[],
  down: readonly ChangeEvent[],
  ctx: ArticleContext,
): string {
  const prefix = `AI 价格周报 ${range}｜`;
  const newModel = added.find(isOfficial);
  const drop = down.find(isOfficial) ?? down[0];
  const pct = drop ? ` ${Math.round(maxPct(drop) * 100)}%` : "";
  const candidates = [
    ...(newModel
      ? [`${newModel.displayName} 上线`, `${ctx.vendorName(newModel.vendor)} 新模型上线`]
      : []),
    ...(drop
      ? [`${drop.displayName} 降价${pct}`, `${ctx.vendorName(drop.vendor)} 降价${pct}`]
      : []),
    added.length + down.length > 0
      ? `新模型 ${groupModels(added).length} · 降价 ${down.length}`
      : "",
    "国内最便宜模型榜",
  ].filter((c) => c !== "");
  const fits = candidates.find((c) => prefix.length + c.length <= MAX_TITLE_LENGTH);
  return `${prefix}${fits ?? "国内最便宜模型榜"}`;
}

export function buildWeeklyArticle(input: WeeklyInput, ctx: ArticleContext): WechatArticle | null {
  const events = input.events.filter((e) => !EXCLUDED_PLATFORMS.has(e.platform));
  const added = events
    .filter((e) => e.type === "new_model" && isOfficial(e))
    .toSorted(byImportance);
  const merged = mergeWeekChanges(events).toSorted(byImportance);
  const down = merged.filter((e) => e.type === "price_down");
  const up = merged.filter((e) => e.type === "price_up");
  const ranking = cheapestCn(input.offerings);
  if (added.length + down.length + up.length + ranking.length === 0) return null;

  const models = groupModels(added);
  const range = `${shortDate(input.start)}-${shortDate(input.end)}`;
  const counts = [
    models.length > 0 ? `新模型 ${models.length}` : "",
    down.length > 0 ? `降价 ${down.length}` : "",
    up.length > 0 ? `涨价 ${up.length}` : "",
  ].filter((c) => c !== "");
  const intro = `<section style="background:linear-gradient(135deg,#eef4ff 0%,#f8faff 100%);border-radius:12px;padding:16px;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:${COLOR.new};font-weight:600;">AI 模型 API 价格周报</p><p style="margin:4px 0 6px;font-size:20px;font-weight:700;color:${COLOR.text};">${range}</p><p style="margin:0;font-size:14px;line-height:1.6;color:${COLOR.text};">${counts.length > 0 ? `本周${counts.join("，")}。` : "本周价格平稳，没有官方变动。"}</p></section><p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${COLOR.muted};">${unitNote(ctx.usdCny)}</p>`;
  const body = [
    models.length > 0
      ? heading("本周新模型", models.length, COLOR.new, COLOR.newBg) +
        cards(
          models.map((g) => newModelCard(g, ctx)),
          "个",
        )
      : "",
    down.length > 0
      ? heading("本周降价", down.length, COLOR.down, COLOR.downBg) +
        cards(
          down.map((e) => changeCard(e, ctx)),
          "条",
        )
      : "",
    up.length > 0
      ? heading("本周涨价", up.length, COLOR.up, COLOR.upBg) +
        cards(
          up.map((e) => changeCard(e, ctx)),
          "条",
        )
      : "",
    ranking.length > 0 ? rankingSection(ranking, ctx) : "",
  ].join("");

  return {
    title: weeklyTitle(range, added, down, ctx),
    digest: truncate(
      `${counts.length > 0 ? `${counts.join(" · ")}；` : ""}附国内最便宜的大模型排行`,
      MAX_DIGEST_LENGTH,
    ),
    html: `<section style="font-family:${FONT};color:${COLOR.text};">${intro}${body}${footer()}</section>`,
    contentSourceUrl: `${input.siteUrl}/changes/wechat/`,
  };
}
