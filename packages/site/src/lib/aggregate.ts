/**
 * 价格榜按模型聚合（DEV §3.10）：同一个模型在官方、聚合平台、云平台、推理服务商的多条报价合成一行，
 * 显示最低价（按混合价，免费和未知排在最后）及其平台，以及平台数；展开后列出全部平台。
 * 先筛选报价再聚合：例如选了「Azure」平台，每行就是该模型在 Azure 上的价格。
 * 浏览器端运行，不能引入 zod。
 */
import { DEFAULT_SORT, sortRows, type TableRow, type TableSort } from "./table";

export interface ModelGroup {
  /** modelSlug */
  readonly id: string;
  /** 最便宜的报价（代表这一行） */
  readonly best: TableRow;
  /** 全部报价，按混合价升序 */
  readonly offerings: readonly TableRow[];
  readonly platformCount: number;
}

/** 价格相同时官方平台排前面（代表行显示「官方」比随便一家转售商更直观） */
export const OFFICIAL_PLATFORMS: ReadonlySet<string> = new Set(["official", "official-cn"]);

function officialFirstOnTies(sorted: readonly TableRow[]): readonly TableRow[] {
  return sorted.toSorted((a, b) => {
    if (a.blendedUsd !== b.blendedUsd || a.isFree !== b.isFree) return 0;
    return Number(OFFICIAL_PLATFORMS.has(b.platform)) - Number(OFFICIAL_PLATFORMS.has(a.platform));
  });
}

export function groupByModel(rows: readonly TableRow[]): readonly ModelGroup[] {
  const buckets = new Map<string, TableRow[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.modelSlug);
    if (bucket) bucket.push(row);
    else buckets.set(row.modelSlug, [row]);
  }
  return [...buckets.entries()].flatMap(([id, bucket]) => {
    const offerings = officialFirstOnTies(sortRows(bucket, DEFAULT_SORT));
    const best = offerings[0];
    if (!best) return [];
    const platformCount = new Set(offerings.map((o) => o.platform)).size;
    return [{ id, best, offerings, platformCount }];
  });
}

/** 排序按代表报价的值；「平台」列在聚合视图下按平台数排序 */
export function sortGroups(groups: readonly ModelGroup[], sort: TableSort): readonly ModelGroup[] {
  if (sort.key === "platform") {
    const factor = sort.dir === "asc" ? 1 : -1;
    return groups.toSorted(
      (a, b) => (a.platformCount - b.platformCount) * factor || a.id.localeCompare(b.id),
    );
  }
  const byBest = new Map(groups.map((g) => [g.best.id, g] as const));
  return sortRows(
    groups.map((g) => g.best),
    sort,
  ).flatMap((row) => {
    const group = byBest.get(row.id);
    return group ? [group] : [];
  });
}
