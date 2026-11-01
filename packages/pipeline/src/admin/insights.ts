/**
 * 本地后台（DEV_DOCUMENT §3.25）的纯计算部分：数据概览、每日变动趋势、数据质量检查。
 * 只读 data/ 里的数据，不改任何文件。
 */
import type { ChangeEvent, Offering } from "@aipb/shared";

export interface Summary {
  readonly models: number;
  readonly offerings: number;
  readonly platforms: number;
  readonly vendors: number;
  readonly removed: number;
}

const TREND_TYPES = ["price_down", "price_up", "new_model", "removed"] as const;
export type TrendType = (typeof TREND_TYPES)[number];
export type TrendDay = { readonly date: string } & Readonly<Record<TrendType, number>>;

const isLive = (o: Offering): boolean => o.status !== "removed";

export function summarize(offerings: readonly Offering[]): Summary {
  const live = offerings.filter(isLive);
  const count = (key: (o: Offering) => string) => new Set(live.map(key)).size;
  return {
    models: count((o) => o.modelSlug),
    offerings: live.length,
    platforms: count((o) => o.platform),
    vendors: count((o) => o.vendor),
    removed: offerings.length - live.length,
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 最近 days 天（含 today）每天各类变动条数；变动事件 ID 以日期开头 */
export function changeTrend(
  events: readonly ChangeEvent[],
  today: string,
  days: number,
): readonly TrendDay[] {
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return dates.map((date) => {
    const sameDay = events.filter((e) => e.id.startsWith(`${date}-`));
    const counts = Object.fromEntries(
      TREND_TYPES.map((type) => [type, sameDay.filter((e) => e.type === type).length]),
    ) as Record<TrendType, number>;
    return { date, ...counts };
  });
}

/** 展示名就是原始 ID：全小写、没有空格 */
export function rawNameOfferings(offerings: readonly Offering[]): readonly Offering[] {
  return offerings.filter(
    (o) => isLive(o) && o.displayName === o.displayName.toLowerCase() && !/\s/.test(o.displayName),
  );
}

/** 归一化模型 ID：2p5 → 2.5，去掉 -instruct，只保留字母、数字和小数点 */
export function normalizeModelKey(model: string): string {
  return model
    .toLowerCase()
    .replace(/(\d)p(\d)/g, "$1.$2")
    .replace(/-instruct\b/g, "")
    .replace(/[^a-z0-9.]/g, "");
}

export interface DuplicateGroup {
  readonly vendor: string;
  readonly slugs: readonly string[];
}

/** 同一厂商下，归一化后相同但模型 ID 不同的一组（疑似同一个模型的不同写法） */
export function duplicateGroups(offerings: readonly Offering[]): readonly DuplicateGroup[] {
  const groups = new Map<string, Set<string>>();
  for (const o of offerings.filter(isLive)) {
    const key = `${o.vendor}/${normalizeModelKey(o.model)}`;
    groups.set(key, new Set([...(groups.get(key) ?? []), o.modelSlug]));
  }
  return [...groups.values()]
    .filter((slugs) => slugs.size > 1)
    .map((slugs) => {
      const sorted = [...slugs].toSorted();
      return { vendor: sorted[0]?.split("/")[0] ?? "", slugs: sorted };
    })
    .toSorted((a, b) => (a.slugs[0] ?? "").localeCompare(b.slugs[0] ?? ""));
}

/** 标记为过期、或连续几天没抓到的在售报价，按缺失天数降序 */
export function staleOfferings(offerings: readonly Offering[]): readonly Offering[] {
  return offerings
    .filter((o) => isLive(o) && (o.stale || o.status === "missing" || o.missingDays > 0))
    .toSorted((a, b) => b.missingDays - a.missingDays || a.id.localeCompare(b.id));
}
