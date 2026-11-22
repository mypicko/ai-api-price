/**
 * 公众号专题文章：国内 vs 海外价格（DEV_DOCUMENT §3.32）。手动触发（wechat-topic 工作流），不进每日任务。
 * - 数据来自线上网站的 /api/v1/cn-vs-intl.json（网站构建时算好，价格已换算成人民币），用共享 schema 校验
 * - 三节：国内买更便宜（比 OpenRouter 便宜最多的）→ 国内反而更贵 → 官方价国内外基本一致（差 ≤5%）
 * - 版式、卡片、配色与日报共用（wechat-article.ts），阅读原文指向 /cn-vs-intl/
 */
import { type CnIntlData, type CnIntlItem, CnIntlPayloadSchema, formatPrice } from "@aipb/shared";
import { PipelineError } from "../core/errors";
import { escapeHtml } from "./format";
import {
  card,
  COLOR,
  FONT,
  footer,
  heading,
  MAX_DIGEST_LENGTH,
  MAX_TITLE_LENGTH,
  muted,
  pill,
  truncate,
  type WechatArticle,
} from "./wechat-article";

const MAX_CHEAPER = 8;
const MAX_PRICIER = 5;
const MAX_SAME = 12;
const SAME_PRICE = 0.05;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchCnIntl(
  siteUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<CnIntlData & { readonly dataDate: string }> {
  const url = `${siteUrl.replace(/\/+$/, "")}/api/v1/cn-vs-intl.json`;
  let body: unknown;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    body = await response.json();
  } catch (error) {
    throw new PipelineError("E5001", `公众号专题：读取 ${url} 失败`, { cause: error });
  }
  return parseCnIntl(body, url);
}

/** 校验接口内容（也用于本地预览时直接读 dist 里的文件） */
export function parseCnIntl(
  body: unknown,
  from: string,
): CnIntlData & { readonly dataDate: string } {
  const parsed = CnIntlPayloadSchema.safeParse(body);
  if (!parsed.success)
    throw new PipelineError("E5001", `公众号专题：${from} 的结构不对（cn-vs-intl）`);
  return { ...parsed.data.data, dataDate: parsed.data.meta.dataDate };
}

const pct = (value: number): string => `${Math.round(Math.abs(value) * 100)}%`;
const yuan = (p: { input: number | null; output: number | null }): string =>
  `${muted("输入")} <strong>${formatPrice(p.input, "CNY")}</strong>&nbsp;&nbsp;${muted("输出")} <strong>${formatPrice(p.output, "CNY")}</strong>`;

function gapCard(item: CnIntlItem): string {
  const cheaper = (item.openrouterPct ?? 0) < 0;
  return card(item.displayName, item.vendorName, [
    `国内官方：${yuan(item.domestic)}`,
    ...(item.openrouter ? [`OpenRouter：${yuan(item.openrouter)}`] : []),
    `${muted("国内比 OpenRouter")}${pill(
      `${cheaper ? "便宜" : "贵"} ${pct(item.openrouterPct ?? 0)}`,
      cheaper ? COLOR.down : COLOR.up,
      cheaper ? COLOR.downBg : COLOR.upBg,
    )}`,
  ]);
}

function chips(items: readonly CnIntlItem[]): string {
  return `<section>${items
    .map(
      (i) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:2px 8px;border-radius:4px;font-size:13px;line-height:1.6;color:${COLOR.text};background:${COLOR.card};">${escapeHtml(i.displayName)} · ${escapeHtml(i.vendorName)}</span>`,
    )
    .join("")}</section>`;
}

function intro(data: CnIntlData, date: string, same: number, usdCny: number | null): string {
  const stats = [
    { value: String(data.summary.total), label: "可对比的模型" },
    {
      value: `${data.summary.openrouter.cheaper}/${data.summary.openrouter.compared}`,
      label: "国内比 OpenRouter 便宜",
    },
    { value: `${same}/${data.summary.intl.compared}`, label: "国内外官方同价" },
  ];
  const cells = stats
    .map(
      (s) =>
        `<section style="flex:1;text-align:center;"><p style="margin:0;font-size:22px;line-height:1.2;font-weight:700;color:${COLOR.new};">${s.value}</p><p style="margin:2px 0 0;font-size:12px;color:${COLOR.muted};">${s.label}</p></section>`,
    )
    .join("");
  const rate = usdCny === null ? "" : `美元价按 1 美元 ≈ ${usdCny.toFixed(2)} 元换算，`;
  return `<section style="background:linear-gradient(135deg,#eef4ff 0%,#f8faff 100%);border-radius:12px;padding:16px;"><p style="margin:0;font-size:12px;letter-spacing:1px;color:${COLOR.new};font-weight:600;">AI 模型 API 价格 · 专题</p><p style="margin:4px 0 14px;font-size:20px;font-weight:700;color:${COLOR.text};">同一个模型，在国内买还是海外买？</p><section style="display:flex;">${cells}</section></section><p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:${COLOR.muted};">数据日期 ${date}。价格单位：人民币 / 每百万 tokens，${rate}按「3 份输入 + 1 份输出」的混合价比较。OpenRouter 价是它最便宜那家服务商的报价。</p>`;
}

export function buildCnIntlArticle(
  data: CnIntlData,
  date: string,
  siteUrl: string,
  usdCny: number | null,
): WechatArticle | null {
  const withOr = data.items.filter((i) => i.openrouterPct !== null);
  const cheaper = withOr
    .filter((i) => (i.openrouterPct ?? 0) < 0)
    .toSorted((a, b) => (a.openrouterPct ?? 0) - (b.openrouterPct ?? 0));
  const pricier = withOr
    .filter((i) => (i.openrouterPct ?? 0) > 0)
    .toSorted((a, b) => (b.openrouterPct ?? 0) - (a.openrouterPct ?? 0));
  const same = data.items.filter((i) => i.intlPct !== null && Math.abs(i.intlPct) <= SAME_PRICE);
  if (cheaper.length + pricier.length + same.length === 0) return null;

  const { cheaper: n, compared } = data.summary.openrouter;
  const candidates = [
    `国内外 AI 价格对比｜${n}/${compared} 个模型国内更便宜`,
    `${n}/${compared} 个 AI 模型国内买更便宜`,
    "同一个 AI 模型，国内买还是海外买？",
  ];
  const title = candidates.find((c) => c.length <= MAX_TITLE_LENGTH) ?? candidates[2] ?? "";
  const top = cheaper[0];
  const body = [
    cheaper.length > 0
      ? heading("国内买更便宜", cheaper.length, COLOR.down, COLOR.downBg) +
        cheaper.slice(0, MAX_CHEAPER).map(gapCard).join("")
      : "",
    pricier.length > 0
      ? heading("国内反而更贵", pricier.length, COLOR.up, COLOR.upBg) +
        pricier.slice(0, MAX_PRICIER).map(gapCard).join("")
      : "",
    same.length > 0
      ? `${heading("官方价国内外基本一致", same.length, COLOR.new, COLOR.newBg)}<p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:${COLOR.text};">这些模型的厂商国内站和海外站价格换算后相差不到 ${pct(SAME_PRICE)}，差别主要来自汇率：</p>${chips(same.slice(0, MAX_SAME))}`
      : "",
  ].join("");
  return {
    title,
    digest: truncate(
      `${n}/${compared} 个模型国内官方价比 OpenRouter 便宜${top ? `，${top.displayName} 便宜 ${pct(top.openrouterPct ?? 0)}` : ""}`,
      MAX_DIGEST_LENGTH,
    ),
    html: `<section style="font-family:${FONT};color:${COLOR.text};">${intro(data, date, same.length, usdCny)}${body}${footer()}</section>`,
    contentSourceUrl: `${siteUrl}/cn-vs-intl/`,
  };
}
