import type { Currency, PriceSet, RawUnit } from "./schema";

const UNIT_MULTIPLIER: Readonly<Record<RawUnit, number>> = {
  per_token: 1_000_000,
  per_1k: 1_000,
  per_1m: 1,
};

/** 保留 6 位有效数字，消除浮点误差（例如 0.00000015 * 1e6 = 0.15000000000000002） */
export function roundSig(value: number, digits = 6): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  return Number(value.toPrecision(digits));
}

/** 原始单位 → 每百万 token */
export function toPerMillion(value: number | null | undefined, unit: RawUnit): number | null {
  if (value === null || value === undefined) return null;
  return roundSig(value * UNIT_MULTIPLIER[unit]);
}

/** 币种换算；usdCny = 1 美元兑多少人民币 */
export function convertCurrency(
  value: number | null,
  from: Currency,
  to: Currency,
  usdCny: number,
): number | null {
  if (value === null) return null;
  if (from === to) return value;
  return roundSig(from === "USD" ? value * usdCny : value / usdCny);
}

export function convertPriceSet(
  prices: PriceSet,
  from: Currency,
  to: Currency,
  usdCny: number,
): PriceSet {
  return {
    input: convertCurrency(prices.input, from, to, usdCny),
    output: convertCurrency(prices.output, from, to, usdCny),
    cacheRead: convertCurrency(prices.cacheRead, from, to, usdCny),
    cacheWrite: convertCurrency(prices.cacheWrite, from, to, usdCny),
  };
}

/** 混合价 = (3 × 输入 + 1 × 输出) / 4 */
export function blendedPrice(input: number | null, output: number | null): number | null {
  if (input === null || output === null) return null;
  return roundSig((3 * input + output) / 4);
}

/** 相对变化 (new-old)/old；旧值为 0/null 或新值为 null 时返回 null */
export function pctChange(oldValue: number | null, newValue: number | null): number | null {
  if (oldValue === null || newValue === null || oldValue === 0) return null;
  return roundSig((newValue - oldValue) / oldValue, 4);
}

/** 相对差值 < 0.01% 视为相等（DEV_DOCUMENT §3.7） */
export function priceEquals(a: number | null, b: number | null, tolerance = 1e-4): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / base < tolerance;
}

export function priceSetEquals(a: PriceSet, b: PriceSet): boolean {
  return (
    priceEquals(a.input, b.input) &&
    priceEquals(a.output, b.output) &&
    priceEquals(a.cacheRead, b.cacheRead) &&
    priceEquals(a.cacheWrite, b.cacheWrite)
  );
}

/** 异常低价倍数：比同模型其它平台的中位数低这么多倍以上视为异常（DEV_DOCUMENT §3.5 V9） */
export const OUTLIER_RATIO = 3;
/** 判定异常低价至少需要的对照报价数 */
export const OUTLIER_MIN_PEERS = 2;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * 异常低价：value × ratio 仍低于对照组中位数，并且比对照组里最便宜的一家还低
 * （与某个已知平台同价说明是真实低价，不算异常）。
 * 对照组只计正数，不足 OUTLIER_MIN_PEERS 个时不判定。
 */
export function isLowOutlier(
  value: number | null,
  peers: readonly (number | null)[],
  ratio = OUTLIER_RATIO,
): boolean {
  if (value === null) return false;
  const valid = peers.filter((p): p is number => p !== null && p > 0);
  if (valid.length < OUTLIER_MIN_PEERS) return false;
  const mid = median(valid);
  const min = Math.min(...valid);
  return mid !== null && value * ratio < mid && value < min && !priceEquals(value, min);
}

/** 输入价 / 输出价中异常低的字段；target 与 peers 须为同一币种 */
export function lowOutlierFields(
  target: PriceSet,
  peers: readonly PriceSet[],
): readonly ("input" | "output")[] {
  return (["input", "output"] as const).filter((field) =>
    isLowOutlier(
      target[field],
      peers.map((p) => p[field]),
    ),
  );
}
