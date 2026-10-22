/**
 * 收藏与并排对比（DEV §3.20）：收藏、对比列表都是 modelSlug 数组，只存在浏览器 localStorage 里。
 * 对比链接 compare/?m=vendor/a,vendor/b 可以直接分享，不需要后端。
 * 浏览器端运行，不能引入 zod。
 */
import { OFFICIAL_PLATFORMS, groupByModel } from "./aggregate";
import type { TableRow } from "./table";

export const MAX_COMPARE = 4;
export const MIN_COMPARE = 2;
/** 收藏上限：防止 localStorage 被异常数据撑大 */
export const MAX_FAVORITES = 200;

const SLUG_PATTERN = /^[a-z0-9][\w.-]*\/[\w.:+-]+$/i;
const MAX_SLUG_LENGTH = 200;

export function isModelSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/** 校验并去重（保持顺序）；非法项直接丢弃 */
export function cleanSlugs(values: readonly unknown[], max: number): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.size >= max) break;
    if (isModelSlug(value)) seen.add(value);
  }
  return [...seen];
}

/** localStorage 里的 JSON 数组；损坏或格式不对时返回空数组 */
export function parseStoredSlugs(raw: string | null, max: number): readonly string[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? cleanSlugs(value, max) : [];
  } catch {
    return [];
  }
}

/** 有则移除、无则追加；已满时不追加（返回原数组） */
export function toggleSlug(list: readonly string[], slug: string, max: number): readonly string[] {
  if (list.includes(slug)) return list.filter((s) => s !== slug);
  if (list.length >= max || !isModelSlug(slug)) return list;
  return [...list, slug];
}

/** ?m=vendor/a,vendor/b；斜杠不转义，分享出去的链接更好读 */
export function compareSearch(slugs: readonly string[]): string {
  const encode = (slug: string): string => encodeURIComponent(slug).replaceAll("%2F", "/");
  return slugs.length === 0 ? "" : `?m=${slugs.map(encode).join(",")}`;
}

export function parseCompareSearch(search: string): readonly string[] {
  const raw = new URLSearchParams(search).get("m");
  if (raw === null) return [];
  return cleanSlugs(raw.split(","), MAX_COMPARE);
}

export interface CompareColumn {
  readonly slug: string;
  readonly displayName: string;
  readonly vendorName: string;
  /** 混合价最低的报价 */
  readonly best: TableRow;
  readonly bestInput: TableRow | null;
  readonly bestOutput: TableRow | null;
  readonly bestCache: TableRow | null;
  readonly official: TableRow | null;
  readonly contextWindow: number | null;
  readonly platformCount: number;
}

/** 在一组报价里找某一项（0 输入 / 1 输出 / 2 缓存命中）最低的，按 USD 比较 */
function lowestBy(rows: readonly TableRow[], index: 0 | 1 | 2): TableRow | null {
  let best: TableRow | null = null;
  for (const row of rows) {
    const value = row.usd[index];
    if (value === null) continue;
    const current = best?.usd[index] ?? null;
    if (current === null || value < current) best = row;
  }
  return best;
}

function maxContext(rows: readonly TableRow[]): number | null {
  const values = rows.flatMap((r) => (r.contextWindow === null ? [] : [r.contextWindow]));
  return values.length === 0 ? null : Math.max(...values);
}

/** 按 slugs 的顺序生成对比列；榜单上找不到的放进 missing */
export function compareColumns(
  rows: readonly TableRow[],
  slugs: readonly string[],
): { readonly columns: readonly CompareColumn[]; readonly missing: readonly string[] } {
  const wanted = new Set(slugs);
  const groups = new Map(
    groupByModel(rows.filter((r) => wanted.has(r.modelSlug))).map((g) => [g.id, g] as const),
  );
  const columns: CompareColumn[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const group = groups.get(slug);
    if (!group) {
      missing.push(slug);
      continue;
    }
    const { best, offerings } = group;
    columns.push({
      slug,
      displayName: best.displayName,
      vendorName: best.vendorName,
      best,
      bestInput: lowestBy(offerings, 0),
      bestOutput: lowestBy(offerings, 1),
      bestCache: lowestBy(offerings, 2),
      official: offerings.find((o) => OFFICIAL_PLATFORMS.has(o.platform)) ?? null,
      contextWindow: maxContext(offerings),
      platformCount: group.platformCount,
    });
  }
  return { columns, missing };
}
