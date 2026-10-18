/**
 * 构建时计算的派生字段（API 文档 §2.1）：converted、blended、change7d。
 */
import type { Currency, HistoryFile, Offering, PricePoint, PriceSet } from "@aipb/shared";
import { addDays } from "./dates";
import { blendedPrice, convertPriceSet, pctChange } from "./shared-client";

export interface ConvertedPrices {
  readonly usd: PriceSet;
  readonly cny: PriceSet;
}

export interface BlendedPrices {
  readonly usd: number | null;
  readonly cny: number | null;
}

export interface Change7d {
  readonly input: number | null;
  readonly output: number | null;
}

/** 公开接口里的 Offering（字段与 API 文档 §2.1 的字段表一一对应） */
export interface PublicOffering extends PriceSet {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly modelSlug: string;
  readonly displayName: string;
  readonly platform: string;
  readonly source: string;
  readonly currency: Currency;
  readonly tiers: Offering["tiers"];
  readonly converted: ConvertedPrices;
  readonly blended: BlendedPrices | null;
  readonly contextWindow: number | null;
  readonly maxOutput: number | null;
  readonly isFree: boolean;
  readonly stale: boolean;
  readonly status: Offering["status"];
  readonly change7d: Change7d | null;
  readonly sourceUrl: string;
  readonly notes: string | null;
  readonly fetchedAt: string;
  readonly publishedAt: string;
}

export const CHANGE_WINDOW_DAYS = 7;

export function pickPrices(source: PriceSet): PriceSet {
  return {
    input: source.input,
    output: source.output,
    cacheRead: source.cacheRead,
    cacheWrite: source.cacheWrite,
  };
}

export function deriveConverted(offering: Offering, usdCny: number): ConvertedPrices {
  const prices = pickPrices(offering);
  return {
    usd: convertPriceSet(prices, offering.currency, "USD", usdCny),
    cny: convertPriceSet(prices, offering.currency, "CNY", usdCny),
  };
}

export function deriveBlended(converted: ConvertedPrices): BlendedPrices | null {
  const usd = blendedPrice(converted.usd.input, converted.usd.output);
  const cny = blendedPrice(converted.cny.input, converted.cny.output);
  return usd === null || cny === null ? null : { usd, cny };
}

/** 变更点序列中，在 date 当天（含）生效的价格 */
export function priceAt(series: readonly PricePoint[], date: string): PricePoint | null {
  return series.filter((point) => point.effectiveDate <= date).at(-1) ?? null;
}

function fieldChange(oldValue: number | null, newValue: number | null): number | null {
  if (oldValue !== null && newValue !== null && oldValue === newValue) return 0;
  return pctChange(oldValue, newValue);
}

/**
 * 与 7 天前相比的相对变化。7 天前还没有这个报价（或没有历史）时返回 null；
 * 没变化的字段为 0。
 */
export function deriveChange7d(
  offering: Offering,
  series: readonly PricePoint[] | undefined,
  dataDate: string,
): Change7d | null {
  if (!series || series.length === 0) return null;
  const before = priceAt(series, addDays(dataDate, -CHANGE_WINDOW_DAYS));
  if (!before) return null;
  return {
    input: fieldChange(before.input, offering.input),
    output: fieldChange(before.output, offering.output),
  };
}

export interface DeriveContext {
  readonly usdCny: number;
  readonly dataDate: string;
  readonly histories: ReadonlyMap<string, HistoryFile>;
}

export function toPublicOffering(offering: Offering, ctx: DeriveContext): PublicOffering {
  const converted = deriveConverted(offering, ctx.usdCny);
  const series = ctx.histories.get(offering.modelSlug)?.series[offering.id];
  return {
    id: offering.id,
    vendor: offering.vendor,
    model: offering.model,
    modelSlug: offering.modelSlug,
    displayName: offering.displayName,
    platform: offering.platform,
    source: offering.source,
    currency: offering.currency,
    input: offering.input,
    output: offering.output,
    cacheRead: offering.cacheRead,
    cacheWrite: offering.cacheWrite,
    tiers: offering.tiers,
    converted,
    blended: deriveBlended(converted),
    contextWindow: offering.contextWindow,
    maxOutput: offering.maxOutput,
    isFree: offering.isFree,
    stale: offering.stale,
    status: offering.status,
    change7d: deriveChange7d(offering, series, ctx.dataDate),
    sourceUrl: offering.sourceUrl,
    notes: offering.notes,
    fetchedAt: offering.fetchedAt,
    publishedAt: offering.publishedAt,
  };
}

/** 7 日变化里绝对值最大的那个（表格只显示一个数） */
export function primaryChange(change: Change7d | null): number | null {
  if (!change) return null;
  const values = [change.input, change.output].filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);
}
