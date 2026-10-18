/**
 * 视频/图像报价（API 文档 §2.9、DEV §3.13）：构建时的派生字段、表格行、排序与筛选。
 * 与文本 token 报价完全分开，不进入价格总榜和成本计算器。
 * 客户端组件也会用到排序/筛选，所以这里不能引入 zod。
 */
import type {
  Currency,
  HistoryFile,
  MediaKind,
  MediaOffering,
  MediaTier,
  MediaUnit,
} from "@aipb/shared";
import { addDays } from "./dates";
import { priceAt } from "./derive";
import type { Locale } from "./locale";
import { convertCurrency, pctChange } from "./shared-client";
import { pageHref } from "./url";

export interface MediaPrices {
  readonly input: number | null;
  readonly output: number | null;
  readonly tiers: readonly MediaTier[] | null;
}

/** 公开接口里的视频/图像报价（字段与 API 文档 §2.9 一一对应） */
export interface PublicMediaOffering {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly modelSlug: string;
  readonly displayName: string;
  readonly platform: string;
  readonly source: string;
  readonly currency: Currency;
  readonly kind: MediaKind;
  readonly unit: MediaUnit;
  readonly input: number | null;
  readonly output: number | null;
  readonly tiers: readonly MediaTier[] | null;
  readonly converted: { readonly usd: MediaPrices; readonly cny: MediaPrices };
  readonly isFree: boolean;
  readonly stale: boolean;
  readonly status: MediaOffering["status"];
  /** 生成价与 7 天前相比的相对变化；没有足够历史时为 null */
  readonly change7d: number | null;
  readonly sourceUrl: string;
  readonly notes: string | null;
  readonly fetchedAt: string;
  readonly publishedAt: string;
}

export interface MediaDeriveContext {
  readonly usdCny: number;
  readonly dataDate: string;
  readonly histories: ReadonlyMap<string, HistoryFile>;
}

function convertPrices(o: MediaOffering, to: Currency, usdCny: number): MediaPrices {
  const convert = (v: number | null): number | null => convertCurrency(v, o.currency, to, usdCny);
  return {
    input: convert(o.input),
    output: convert(o.output),
    tiers: o.tiers?.map((t) => ({ label: t.label, output: convert(t.output) })) ?? null,
  };
}

function change7d(o: MediaOffering, ctx: MediaDeriveContext): number | null {
  const series = ctx.histories.get(o.modelSlug)?.series[o.id];
  const before = series ? priceAt(series, addDays(ctx.dataDate, -7)) : null;
  if (!before) return null;
  return before.output === o.output ? 0 : pctChange(before.output, o.output);
}

export function toPublicMediaOffering(
  o: MediaOffering,
  ctx: MediaDeriveContext,
): PublicMediaOffering {
  return {
    id: o.id,
    vendor: o.vendor,
    model: o.model,
    modelSlug: o.modelSlug,
    displayName: o.displayName,
    platform: o.platform,
    source: o.source,
    currency: o.currency,
    kind: o.kind,
    unit: o.unit,
    input: o.input,
    output: o.output,
    tiers: o.tiers,
    converted: {
      usd: convertPrices(o, "USD", ctx.usdCny),
      cny: convertPrices(o, "CNY", ctx.usdCny),
    },
    isFree: o.isFree,
    stale: o.stale,
    status: o.status,
    change7d: change7d(o, ctx),
    sourceUrl: o.sourceUrl,
    notes: o.notes,
    fetchedAt: o.fetchedAt,
    publishedAt: o.publishedAt,
  };
}

// ───────────────────────── 表格 ─────────────────────────

export interface MediaTierCell {
  readonly label: string;
  readonly usd: number | null;
  readonly cny: number | null;
}

/** MediaTable 的一行（可序列化） */
export interface MediaRow {
  readonly id: string;
  readonly kind: MediaKind;
  readonly unit: MediaUnit;
  readonly displayName: string;
  readonly model: string;
  readonly vendor: string;
  readonly vendorName: string;
  readonly platformName: string;
  readonly currency: Currency;
  /** [生成价, 输入图价] */
  readonly usd: readonly [number | null, number | null];
  readonly cny: readonly [number | null, number | null];
  readonly tiers: readonly MediaTierCell[];
  readonly change7d: number | null;
  readonly stale: boolean;
  readonly status: MediaOffering["status"];
  readonly fetchedAt: string;
  readonly sourceUrl: string;
}

export interface RowNames {
  readonly vendorName: string;
  readonly platformName: string;
}

export function toMediaRow(o: PublicMediaOffering, names: RowNames): MediaRow {
  const { usd, cny } = o.converted;
  return {
    id: o.id,
    kind: o.kind,
    unit: o.unit,
    displayName: o.displayName,
    model: o.model,
    vendor: o.vendor,
    vendorName: names.vendorName,
    platformName: names.platformName,
    currency: o.currency,
    usd: [usd.output, usd.input],
    cny: [cny.output, cny.input],
    tiers: (o.tiers ?? []).map((t, i) => ({
      label: t.label,
      usd: usd.tiers?.[i]?.output ?? null,
      cny: cny.tiers?.[i]?.output ?? null,
    })),
    change7d: o.change7d,
    stale: o.stale,
    status: o.status,
    fetchedAt: o.fetchedAt,
    sourceUrl: o.sourceUrl,
  };
}

export type MediaSortKey = "model" | "vendor" | "platform" | "price" | "input" | "updated";
export interface MediaSort {
  readonly key: MediaSortKey;
  readonly dir: "asc" | "desc";
}
export const DEFAULT_MEDIA_SORT: MediaSort = { key: "price", dir: "asc" };
export const MEDIA_KINDS: readonly MediaKind[] = ["video", "image"];

export interface MediaFilters {
  readonly kind: MediaKind;
  readonly query: string;
}

/** 参与关键字搜索的字段 */
interface SearchFields {
  readonly displayName: string;
  readonly model: string;
  readonly vendorName: string;
  readonly platformName: string;
}

/** 关键字按空格拆词，每个词都要出现在展示名、模型 ID、厂商名或平台名里（不区分大小写） */
function matchesQuery(row: SearchFields, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${row.displayName} ${row.model} ${row.vendorName} ${row.platformName}`;
  return terms.every((term) => haystack.toLowerCase().includes(term));
}

export function filterMediaRows(
  rows: readonly MediaRow[],
  filters: MediaFilters,
): readonly MediaRow[] {
  return rows.filter((r) => r.kind === filters.kind && matchesQuery(r, filters.query));
}

function sortValue(row: MediaRow, key: MediaSortKey): string | number | null {
  switch (key) {
    case "model":
      return row.displayName.toLowerCase();
    case "vendor":
      return row.vendorName.toLowerCase();
    case "platform":
      return row.platformName.toLowerCase();
    case "price":
      return row.usd[0];
    case "input":
      return row.usd[1];
    case "updated":
      return row.fetchedAt;
  }
}

/** 空值总是排在最后；相同时按 ID 保证稳定 */
export function sortMediaRows(rows: readonly MediaRow[], sort: MediaSort): readonly MediaRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null || vb === null)
      return va === vb ? a.id.localeCompare(b.id) : va === null ? 1 : -1;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return cmp * sign || a.id.localeCompare(b.id);
  });
}

/** 再次点击同一列切换方向；换列时价格类默认升序，名称类默认升序，更新时间默认降序 */
export function nextMediaSort(current: MediaSort, key: MediaSortKey): MediaSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "updated" ? "desc" : "asc" };
}

export function mediaAriaSort(
  sort: MediaSort,
  key: MediaSortKey,
): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

/** URL 里的 ?kind=image；无效值回落到视频 */
export function parseMediaKind(search: string): MediaKind {
  const kind = new URLSearchParams(search).get("kind");
  return kind === "image" ? "image" : "video";
}

export function countByKind(rows: readonly MediaRow[]): Readonly<Record<MediaKind, number>> {
  return {
    video: rows.filter((r) => r.kind === "video").length,
    image: rows.filter((r) => r.kind === "image").length,
  };
}

export const MAX_MEDIA_QUERY_LENGTH = 100;

export function parseMediaQuery(search: string): string {
  return (new URLSearchParams(search).get("q") ?? "").slice(0, MAX_MEDIA_QUERY_LENGTH);
}

/** 首页统一搜索用的精简条目（首页不需要分档、7 日变化等字段，减小水合数据） */
export interface MediaSearchItem extends SearchFields {
  readonly id: string;
  readonly kind: MediaKind;
  readonly unit: MediaUnit;
  readonly currency: Currency;
  readonly usd: number | null;
  readonly cny: number | null;
}

export function toMediaSearchItem(row: MediaRow): MediaSearchItem {
  return {
    id: row.id,
    kind: row.kind,
    unit: row.unit,
    displayName: row.displayName,
    model: row.model,
    vendorName: row.vendorName,
    platformName: row.platformName,
    currency: row.currency,
    usd: row.usd[0],
    cny: row.cny[0],
  };
}

/** 首页搜索命中的视频/图像报价：空关键字不返回；视频在前，同类按生成价升序 */
export function searchMedia(
  items: readonly MediaSearchItem[],
  query: string,
): readonly MediaSearchItem[] {
  if (query.trim() === "") return [];
  return items
    .filter((item) => matchesQuery(item, query))
    .toSorted(
      (a, b) =>
        MEDIA_KINDS.indexOf(a.kind) - MEDIA_KINDS.indexOf(b.kind) ||
        (a.usd ?? Infinity) - (b.usd ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
}

/** 视频/图像页链接，带上关键字和类型（视频是默认类型，不写进 URL） */
export function mediaSearchHref(
  base: string,
  locale: Locale,
  query: string,
  kind: MediaKind,
): string {
  const params = new URLSearchParams();
  if (kind !== "video") params.set("kind", kind);
  if (query.trim() !== "") params.set("q", query.trim());
  const search = params.toString();
  return `${pageHref(base, locale, "media/")}${search ? `?${search}` : ""}`;
}
