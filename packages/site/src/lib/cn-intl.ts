/**
 * 国内原价 vs 海外价（DEV §3.32，页面 /cn-vs-intl/）：同一模型的国内官方人民币价，分别与
 * 海外官方价（`official:` 平台、美元标价，例如 Kimi、通义千问、MiniMax 的国际站）和 OpenRouter 价比较。
 * - 都按混合价（3:1，换算成美元）比较；价差 = (国内 − 海外) / 海外，负数 = 国内更便宜
 * - 国内价口径与首页价差榜相同（`gap.ts` 的 domesticOffering）；OpenRouter 价异常低时同样不比（V9）
 * - 只要有一边可比就列出；有 OpenRouter 价的排前面，按国内便宜多少从多到少，其余按海外官方价差
 * - 阿里的 `official:` 是国际站文档里的北京地域价（美元标价，仍是国内价），不算海外官方价
 * - 2026-11-22 实测：Kimi、MiniMax 国内外官方价换算后只差 0～5%（汇率），差价主要来自 OpenRouter
 */
import type { CnIntlData } from "@aipb/shared";
import { type ApiEnvelope, baseMeta, envelope } from "./api";
import type { PublicOffering } from "./derive";
import { domesticOffering, isOpenRouterOutlier } from "./gap";
import { type SiteModel, vendorName } from "./site-model";

/** `official:` 平台不是海外价的厂商 */
const NOT_OVERSEAS_OFFICIAL: ReadonlySet<string> = new Set(["alibaba"]);

export interface CnIntlRow {
  readonly modelSlug: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly domestic: PublicOffering;
  readonly intl: PublicOffering | null;
  readonly intlPct: number | null;
  readonly openrouter: PublicOffering | null;
  readonly openrouterPct: number | null;
}

export interface CnIntlSummary {
  readonly total: number;
  readonly intl: { readonly compared: number; readonly cheaper: number };
  readonly openrouter: { readonly compared: number; readonly cheaper: number };
}

const blendedUsd = (o: PublicOffering | null | undefined): number | null => {
  const value = o?.blended?.usd ?? null;
  return value !== null && value > 0 ? value : null;
};

function pctAgainst(domestic: number, other: PublicOffering | null): number | null {
  const b = blendedUsd(other);
  return b === null ? null : (domestic - b) / b;
}

function rowFor(
  model: SiteModel,
  slug: string,
  sameModel: readonly PublicOffering[],
): CnIntlRow | null {
  const domestic = domesticOffering(model, slug);
  const a = blendedUsd(domestic);
  if (!domestic || a === null) return null;
  const official = model.offeringsById.get(`official:${slug}`) ?? null;
  const intl =
    official &&
    official.currency === "USD" &&
    !NOT_OVERSEAS_OFFICIAL.has(official.vendor) &&
    blendedUsd(official) !== null
      ? official
      : null;
  const or = model.offeringsById.get(`openrouter:${slug}`) ?? null;
  const openrouter =
    or && blendedUsd(or) !== null && !isOpenRouterOutlier(or, sameModel) ? or : null;
  if (!intl && !openrouter) return null;
  return {
    modelSlug: slug,
    displayName: domestic.displayName,
    vendor: domestic.vendor,
    domestic,
    intl,
    intlPct: pctAgainst(a, intl),
    openrouter,
    openrouterPct: pctAgainst(a, openrouter),
  };
}

const order = (x: CnIntlRow, y: CnIntlRow): number => {
  const hasX = x.openrouterPct !== null;
  const hasY = y.openrouterPct !== null;
  if (hasX !== hasY) return hasX ? -1 : 1;
  const px = x.openrouterPct ?? x.intlPct ?? 0;
  const py = y.openrouterPct ?? y.intlPct ?? 0;
  return px - py || x.modelSlug.localeCompare(y.modelSlug);
};

export function cnIntlRows(model: SiteModel): readonly CnIntlRow[] {
  const bySlug = new Map<string, PublicOffering[]>();
  for (const o of model.offerings) bySlug.set(o.modelSlug, [...(bySlug.get(o.modelSlug) ?? []), o]);
  return [...bySlug]
    .flatMap(([slug, sameModel]) => {
      const row = rowFor(model, slug, sameModel);
      return row ? [row] : [];
    })
    .toSorted(order);
}

export function cnIntlSummary(rows: readonly CnIntlRow[]): CnIntlSummary {
  const count = (pick: (r: CnIntlRow) => number | null) => ({
    compared: rows.filter((r) => pick(r) !== null).length,
    cheaper: rows.filter((r) => (pick(r) ?? 0) < 0).length,
  });
  return {
    total: rows.length,
    intl: count((r) => r.intlPct),
    openrouter: count((r) => r.openrouterPct),
  };
}

const cnyPair = (o: PublicOffering) => ({
  input: o.converted.cny.input,
  output: o.converted.cny.output,
});

/** /api/v1/cn-vs-intl.json：价格换算成人民币，供公众号专题文章和第三方使用 */
export function cnIntlPayload(model: SiteModel): ApiEnvelope<CnIntlData> {
  const rows = cnIntlRows(model);
  const items = rows.map((r) => ({
    modelSlug: r.modelSlug,
    displayName: r.displayName,
    vendor: r.vendor,
    vendorName: vendorName(model, r.vendor, "zh"),
    domestic: cnyPair(r.domestic),
    openrouter: r.openrouter ? cnyPair(r.openrouter) : null,
    openrouterPct: r.openrouterPct,
    intl: r.intl ? cnyPair(r.intl) : null,
    intlPct: r.intlPct,
  }));
  const fx = model.data.fx.latest;
  return envelope(
    { summary: cnIntlSummary(rows), items },
    baseMeta(model, {
      count: items.length,
      fxRate: { usdCny: fx.usdCny, date: fx.date, provider: fx.provider },
    }),
  );
}
