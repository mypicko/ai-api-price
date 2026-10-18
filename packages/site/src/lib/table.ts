/**
 * 价格总榜的筛选、排序和 URL 参数同步（DEV §3.10、STYLE §8）。浏览器端运行，不能引入 zod。
 */
import type { Currency, OfferingStatus, Region } from "@aipb/shared";

/** [input, output, cacheRead] */
export type PriceTriple = readonly [number | null, number | null, number | null];

export interface TableRow {
  readonly id: string;
  readonly modelSlug: string;
  readonly model: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly vendorName: string;
  readonly region: Region;
  readonly platform: string;
  readonly platformName: string;
  readonly currency: Currency;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly usd: PriceTriple;
  readonly cny: PriceTriple;
  /** 排序用：换算成 USD 的混合价（换算是线性的，所以按 USD 排和按 CNY 排顺序一致） */
  readonly blendedUsd: number | null;
  readonly contextWindow: number | null;
  readonly change7d: number | null;
  readonly isFree: boolean;
  readonly stale: boolean;
  readonly status: OfferingStatus;
  readonly fetchedAt: string;
  readonly hasTiers: boolean;
}

export const SORT_KEYS = [
  "blended",
  "vendor",
  "model",
  "platform",
  "input",
  "output",
  "cacheRead",
  "context",
  "change7d",
  "updated",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export interface TableSort {
  readonly key: SortKey;
  readonly dir: SortDir;
}

export const DEFAULT_SORT: TableSort = { key: "blended", dir: "asc" };

export type RegionFilter = "all" | Region;

export interface TableFilters {
  readonly q: string;
  readonly vendors: readonly string[];
  /** 选中的 modelSlug（vendor/model） */
  readonly models: readonly string[];
  readonly region: RegionFilter;
  readonly platform: string;
  readonly freeOnly: boolean;
  readonly minContext: number | null;
}

export const DEFAULT_FILTERS: TableFilters = {
  q: "",
  vendors: [],
  models: [],
  region: "all",
  platform: "all",
  freeOnly: false,
  minContext: null,
};

export const CONTEXT_OPTIONS = [32_000, 128_000, 200_000, 1_000_000] as const;

export const PAGE_SIZE = 100;

const ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/;

export interface ModelOption {
  /** modelSlug */
  readonly id: string;
  readonly name: string;
  /** 厂商名，用于分组显示和排序 */
  readonly hint: string;
}

/** 模型下拉选项：按 modelSlug 去重；选了厂商时只列这些厂商的模型 */
export function modelOptions(
  rows: readonly TableRow[],
  vendors: readonly string[],
  locale: "zh" | "en",
): readonly ModelOption[] {
  const bySlug = new Map<string, ModelOption>();
  for (const row of rows) {
    if (vendors.length > 0 && !vendors.includes(row.vendor)) continue;
    const existing = bySlug.get(row.modelSlug);
    // 同一模型优先用官方平台的名称
    if (!existing || row.platform === "official") {
      bySlug.set(row.modelSlug, { id: row.modelSlug, name: row.displayName, hint: row.vendorName });
    }
  }
  const collator = new Intl.Collator(locale === "zh" ? "zh" : "en");
  return [...bySlug.values()].toSorted(
    (a, b) => collator.compare(a.hint, b.hint) || collator.compare(a.name, b.name),
  );
}

/** 厂商筛选变化后，去掉不属于这些厂商的已选模型 */
export function pruneModels(models: readonly string[], vendors: readonly string[]): string[] {
  if (vendors.length === 0) return [...models];
  return models.filter((slug) => vendors.includes(slug.split("/")[0] ?? ""));
}

function sortValue(row: TableRow, key: SortKey): number | string | null {
  switch (key) {
    case "blended":
      // 免费模型（多为限时/实验版）排在付费模型之后，避免占满榜首；勾选「仅免费」即可查看
      return row.isFree ? null : row.blendedUsd;
    case "vendor":
      return row.vendorName.toLowerCase();
    case "model":
      return row.displayName.toLowerCase();
    case "platform":
      return row.platformName.toLowerCase();
    case "input":
      return row.usd[0];
    case "output":
      return row.usd[1];
    case "cacheRead":
      return row.usd[2];
    case "context":
      return row.contextWindow;
    case "change7d":
      return row.change7d;
    case "updated":
      return row.fetchedAt;
  }
}

function compareValues(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** 排序：空值永远排在最后；相同值按 id 保持稳定 */
export function sortRows(rows: readonly TableRow[], sort: TableSort): readonly TableRow[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb === null) return a.id.localeCompare(b.id);
    if (va === null) return 1;
    if (vb === null) return -1;
    return compareValues(va, vb) * factor || a.id.localeCompare(b.id);
  });
}

/** 点击表头：升序 → 降序 → 默认 */
export function nextSort(current: TableSort, key: SortKey): TableSort {
  if (current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return DEFAULT_SORT;
}

function matchesQuery(row: TableRow, q: string): boolean {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack =
    `${row.displayName} ${row.modelSlug} ${row.vendorName} ${row.platformName}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterRows(rows: readonly TableRow[], filters: TableFilters): readonly TableRow[] {
  return rows.filter(
    (row) =>
      matchesQuery(row, filters.q) &&
      (filters.vendors.length === 0 || filters.vendors.includes(row.vendor)) &&
      (filters.models.length === 0 || filters.models.includes(row.modelSlug)) &&
      (filters.region === "all" || row.region === filters.region) &&
      (filters.platform === "all" || row.platform === filters.platform) &&
      (!filters.freeOnly || row.isFree) &&
      (filters.minContext === null || (row.contextWindow ?? 0) >= filters.minContext),
  );
}

export function isDefaultFilters(filters: TableFilters): boolean {
  return (
    filters.q === "" &&
    filters.vendors.length === 0 &&
    filters.models.length === 0 &&
    filters.region === "all" &&
    filters.platform === "all" &&
    !filters.freeOnly &&
    filters.minContext === null
  );
}

function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/** models = 按模型聚合（默认）；offers = 逐条报价 */
export type TableView = "models" | "offers";
export const DEFAULT_VIEW: TableView = "models";

export interface TableState {
  readonly filters: TableFilters;
  readonly sort: TableSort;
  readonly view: TableView;
}

const MAX_QUERY_LENGTH = 100;

/** URL 查询参数 → 状态；非法值一律忽略，回到默认 */
export function parseTableState(search: string): TableState {
  const params = new URLSearchParams(search);
  const vendors = (params.get("vendor") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => ID_PATTERN.test(v));
  const models = (params.get("model") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => SLUG_PATTERN.test(v));
  const region = params.get("region");
  const platform = params.get("platform") ?? "all";
  const ctx = Number(params.get("ctx"));
  const sortKey = params.get("sort") ?? "";
  const dir = params.get("dir") === "desc" ? "desc" : "asc";
  return {
    filters: {
      q: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH),
      vendors: [...new Set(vendors)],
      models: [...new Set(models)],
      region: region === "intl" || region === "cn" ? region : "all",
      platform: ID_PATTERN.test(platform) ? platform : "all",
      freeOnly: params.get("free") === "1",
      minContext: Number.isInteger(ctx) && ctx > 0 ? ctx : null,
    },
    sort: isSortKey(sortKey) ? { key: sortKey, dir } : DEFAULT_SORT,
    view: params.get("view") === "offers" ? "offers" : DEFAULT_VIEW,
  };
}

/** 状态 → URL 查询参数（默认值不写，保持链接简短）；返回值不含 ? */
export function serializeTableState(state: TableState): string {
  const { filters, sort, view } = state;
  const entries: [string, string][] = [
    ["view", view === DEFAULT_VIEW ? "" : view],
    ["q", filters.q.trim()],
    ["vendor", filters.vendors.join(",")],
    ["model", filters.models.join(",")],
    ["region", filters.region === "all" ? "" : filters.region],
    ["platform", filters.platform === "all" ? "" : filters.platform],
    ["free", filters.freeOnly ? "1" : ""],
    ["ctx", filters.minContext === null ? "" : String(filters.minContext)],
    ["sort", sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir ? "" : sort.key],
    ["dir", sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir ? "" : sort.dir],
  ];
  return new URLSearchParams(entries.filter(([, v]) => v !== "")).toString();
}

export function ariaSort(sort: TableSort, key: SortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

export function pricesFor(row: TableRow, currency: Currency): PriceTriple {
  return currency === "USD" ? row.usd : row.cny;
}
