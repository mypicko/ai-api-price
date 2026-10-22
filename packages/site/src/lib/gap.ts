/**
 * 国内外价差（DEV §3.17）：同一模型的国内官方价 vs OpenRouter 价，按混合价（USD）比较。
 * 国内官方价优先取「官方（国内站）」，没有时取国内厂商以人民币计价的官方价。
 * OpenRouter 的模型价是它当前排在前面的那家服务商的报价，不一定是最低价。
 */
import type { PublicOffering } from "./derive";
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

export function gapFor(model: SiteModel, slug: string): PriceGap | null {
  const domestic = domesticOffering(model, slug);
  const openrouter = model.offeringsById.get(`openrouter:${slug}`);
  const a = domestic?.blended?.usd ?? null;
  const b = openrouter?.blended?.usd ?? null;
  if (!domestic || !openrouter || a === null || b === null || a <= 0 || b <= 0) return null;
  return {
    modelSlug: slug,
    displayName: domestic.displayName,
    vendor: domestic.vendor,
    domestic,
    openrouter,
    pct: (a - b) / b,
  };
}

/** 全部有价差的模型，按价差绝对值降序 */
export function allGaps(model: SiteModel): readonly PriceGap[] {
  const slugs = new Set(model.offerings.map((o) => o.modelSlug));
  return [...slugs]
    .flatMap((slug) => {
      const gap = gapFor(model, slug);
      return gap ? [gap] : [];
    })
    .toSorted(
      (x, y) => Math.abs(y.pct) - Math.abs(x.pct) || x.modelSlug.localeCompare(y.modelSlug),
    );
}
