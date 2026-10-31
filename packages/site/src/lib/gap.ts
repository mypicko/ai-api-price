/**
 * 国内外价差（DEV §3.17）：同一模型的国内官方价 vs OpenRouter 价，按混合价（USD）比较。
 * 国内官方价优先取「官方（国内站）」，没有时取国内厂商以人民币计价的官方价。
 * OpenRouter 的模型价是它当前最便宜那家服务商的报价；输入价或输出价比同模型其它平台的中位数
 * 低 3 倍以上时（多为小服务商的特殊定价），视为不具代表性，不算价差（DEV §3.5 V9）。
 */
import type { PublicOffering } from "./derive";
import { lowOutlierFields } from "./shared-client";
import type { SiteModel } from "./site-model";

export interface PriceGap {
  readonly modelSlug: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly domestic: PublicOffering;
  readonly openrouter: PublicOffering;
  /** (国内 − OpenRouter) / OpenRouter；负数 = 国内更便宜 */
  readonly pct: number;
}

function domesticOffering(model: SiteModel, slug: string): PublicOffering | null {
  const cn = model.offeringsById.get(`official-cn:${slug}`);
  if (cn) return cn;
  const official = model.offeringsById.get(`official:${slug}`);
  return official?.currency === "CNY" ? official : null;
}

/** OpenRouter 价相对同模型其它平台异常低 */
export function isOpenRouterOutlier(
  openrouter: PublicOffering,
  sameModel: readonly PublicOffering[],
): boolean {
  const peers = sameModel.filter((o) => o.platform !== "openrouter").map((o) => o.converted.usd);
  return lowOutlierFields(openrouter.converted.usd, peers).length > 0;
}

function gapWith(
  model: SiteModel,
  slug: string,
  sameModel: readonly PublicOffering[],
): PriceGap | null {
  const domestic = domesticOffering(model, slug);
  const openrouter = model.offeringsById.get(`openrouter:${slug}`);
  const a = domestic?.blended?.usd ?? null;
  const b = openrouter?.blended?.usd ?? null;
  if (!domestic || !openrouter || a === null || b === null || a <= 0 || b <= 0) return null;
  if (isOpenRouterOutlier(openrouter, sameModel)) return null;
  return {
    modelSlug: slug,
    displayName: domestic.displayName,
    vendor: domestic.vendor,
    domestic,
    openrouter,
    pct: (a - b) / b,
  };
}

export function gapFor(model: SiteModel, slug: string): PriceGap | null {
  return gapWith(
    model,
    slug,
    model.offerings.filter((o) => o.modelSlug === slug),
  );
}

/** 全部有价差的模型，按价差绝对值降序 */
export function allGaps(model: SiteModel): readonly PriceGap[] {
  const bySlug = new Map<string, PublicOffering[]>();
  for (const o of model.offerings) bySlug.set(o.modelSlug, [...(bySlug.get(o.modelSlug) ?? []), o]);
  return [...bySlug]
    .flatMap(([slug, sameModel]) => {
      const gap = gapWith(model, slug, sameModel);
      return gap ? [gap] : [];
    })
    .toSorted(
      (x, y) => Math.abs(y.pct) - Math.abs(x.pct) || x.modelSlug.localeCompare(y.modelSlug),
    );
}
