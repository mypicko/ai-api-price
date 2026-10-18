/**
 * 价格历史：变更点序列（DEV_DOCUMENT §2.2、§4.2）。
 * - 同一 offeringId 的 effectiveDate 严格递增，相邻两点价格不同
 * - 同一天再次变化时替换当天的点；替换后与前一个点相同则删除当天的点
 * - 已下架的模型保留文件，不再追加
 */
import { priceSetEquals, type HistoryFile, type Offering, type PricePoint } from "@aipb/shared";
import { pickPrices } from "./quarantine";
import { stableStringify } from "./stable-json";

export function historyRelativePath(modelSlug: string): string {
  const [vendor, model] = modelSlug.split("/");
  return `history/${vendor}/${model}.json`;
}

export function appendPoint(
  series: readonly PricePoint[],
  offering: Offering,
  today: string,
): readonly PricePoint[] {
  const point: PricePoint = { effectiveDate: today, ...pickPrices(offering) };
  const last = series.at(-1);
  if (last && priceSetEquals(last, point)) return series;
  if (!last || last.effectiveDate < today) return [...series, point];
  // 当天已有点：替换；如果替换后和前一个点一样，说明当天又改回去了
  const before = series.slice(0, -1);
  const previous = before.at(-1);
  return previous && priceSetEquals(previous, point) ? before : [...before, point];
}

export interface HistoryUpdateInput {
  readonly offerings: readonly Offering[];
  readonly existing: ReadonlyMap<string, HistoryFile>;
  readonly today: string;
}

function sortSeries(
  series: Readonly<Record<string, readonly PricePoint[]>>,
): Record<string, PricePoint[]> {
  return Object.fromEntries(
    Object.keys(series)
      .toSorted()
      .map((k) => [k, [...(series[k] ?? [])]]),
  );
}

/** 返回需要写入的 history 文件（按 modelSlug），没有变化的文件不返回 */
export function planHistoryUpdates(input: HistoryUpdateInput): ReadonlyMap<string, HistoryFile> {
  const live = input.offerings.filter((o) => o.status !== "removed" && !o.stale);
  const slugs = [...new Set(live.map((o) => o.modelSlug))].toSorted();
  const updates = slugs.flatMap((slug) => {
    const file = input.existing.get(slug) ?? { modelSlug: slug, series: {} };
    const series = live
      .filter((o) => o.modelSlug === slug)
      .reduce<Readonly<Record<string, readonly PricePoint[]>>>(
        (acc, o) => ({ ...acc, [o.id]: appendPoint(acc[o.id] ?? [], o, input.today) }),
        file.series,
      );
    const next: HistoryFile = { modelSlug: slug, series: sortSeries(series) };
    const unchanged =
      input.existing.has(slug) && stableStringify(file.series) === stableStringify(next.series);
    return unchanged ? [] : [[slug, next] as const];
  });
  return new Map(updates);
}
