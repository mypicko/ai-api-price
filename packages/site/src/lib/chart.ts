/**
 * 价格走势图的数据准备（STYLE §9）：变更点序列 → uPlot 的对齐数据（阶梯线）。
 * 浏览器端运行，不能引入 zod。
 */
import type { Currency, PricePoint } from "@aipb/shared";
import { addDays, dateToUnix } from "./dates";
import { convertCurrency, pctChange } from "./shared-client";

export interface ChartOffering {
  readonly id: string;
  readonly label: string;
  readonly currency: Currency;
  readonly points: readonly PricePoint[];
}

export type ChartField = "input" | "output";

export interface ChartSeries {
  readonly offeringId: string;
  readonly label: string;
  readonly field: ChartField;
  /** 第几个平台，用于选类别色 */
  readonly colorIndex: number;
  readonly values: readonly (number | null)[];
  /** 价格变化的点（相对上一个点），用于画小圆点 */
  readonly changeIndexes: readonly number[];
}

export interface ChartData {
  /** 北京时间日期 */
  readonly dates: readonly string[];
  /** Unix 秒 */
  readonly xs: readonly number[];
  readonly series: readonly ChartSeries[];
}

export const RANGES = ["30d", "90d", "1y", "all"] as const;
export type ChartRange = (typeof RANGES)[number];
const RANGE_DAYS: Readonly<Record<Exclude<ChartRange, "all">, number>> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

function valueAt(
  points: readonly PricePoint[],
  date: string,
  field: ChartField,
): number | null | undefined {
  const point = points.filter((p) => p.effectiveDate <= date).at(-1);
  return point === undefined ? undefined : point[field];
}

/** 所有价格都只有一个点 → 不画图 */
export function isUnchanged(offerings: readonly ChartOffering[]): boolean {
  return offerings.every((o) => o.points.length <= 1);
}

export function earliestDate(offerings: readonly ChartOffering[]): string | null {
  return offerings.flatMap((o) => o.points.map((p) => p.effectiveDate)).toSorted()[0] ?? null;
}

function changeIndexes(values: readonly (number | null)[]): readonly number[] {
  return values.flatMap((value, i) => {
    if (i === 0 || value === null) return [];
    const previous = values[i - 1];
    return previous !== null && previous !== undefined && previous !== value ? [i] : [];
  });
}

export interface BuildChartOptions {
  readonly currency: Currency;
  readonly usdCny: number;
  /** 最后一个点之后延续到哪天（一般是 dataDate） */
  readonly endDate: string;
  readonly range: ChartRange;
}

function rangeStart(range: ChartRange, endDate: string, firstDate: string): string {
  if (range === "all") return firstDate;
  const start = addDays(endDate, -RANGE_DAYS[range]);
  return start > firstDate ? start : firstDate;
}

export function buildChartData(
  offerings: readonly ChartOffering[],
  options: BuildChartOptions,
): ChartData {
  const first = earliestDate(offerings);
  if (first === null) return { dates: [], xs: [], series: [] };
  const start = rangeStart(options.range, options.endDate, first);
  const changeDates = offerings
    .flatMap((o) => o.points.map((p) => p.effectiveDate))
    .filter((d) => d > start);
  const dates = [...new Set([start, ...changeDates, options.endDate])]
    .filter((d) => d <= options.endDate)
    .toSorted();
  const fields: readonly ChartField[] = ["output", "input"];
  const series = offerings.flatMap((offering, colorIndex) =>
    fields.map((field): ChartSeries => {
      const values = dates.map((date) => {
        const raw = valueAt(offering.points, date, field);
        return raw === undefined
          ? null
          : convertCurrency(raw, offering.currency, options.currency, options.usdCny);
      });
      return {
        offeringId: offering.id,
        label: offering.label,
        field,
        colorIndex,
        values,
        changeIndexes: changeIndexes(values),
      };
    }),
  );
  return { dates, xs: dates.map(dateToUnix), series };
}

/** 某个变化点相对上一个点的变化，悬停提示用 */
export function changeAt(series: ChartSeries, index: number): number | null {
  if (index <= 0) return null;
  return pctChange(series.values[index - 1] ?? null, series.values[index] ?? null);
}
