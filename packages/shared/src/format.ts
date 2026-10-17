/**
 * 展示格式化（STYLE §10）。site 和推送消息共用。
 */
import type { Currency } from "./schema";

export type Locale = "zh" | "en";

const CURRENCY_SYMBOL: Readonly<Record<Currency, string>> = { USD: "$", CNY: "¥" };

export function currencySymbol(currency: Currency): string {
  return CURRENCY_SYMBOL[currency];
}

/** 只格式化数字部分：≥100 整数千分位；1~100 两位小数；<1 三位有效数字 */
export function formatPriceNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(value).toLocaleString("en-US");
  if (abs >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

export interface FormatPriceOptions {
  readonly locale?: Locale;
  /** 换算价格前面加 ≈ */
  readonly approx?: boolean;
}

/** null → "—"，0 → 免费 / Free，其他按 STYLE §10.1 */
export function formatPrice(
  value: number | null,
  currency: Currency,
  options: FormatPriceOptions = {},
): string {
  const { locale = "zh", approx = false } = options;
  if (value === null) return "—";
  if (value === 0) return locale === "zh" ? "免费" : "Free";
  return `${approx ? "≈ " : ""}${currencySymbol(currency)}${formatPriceNumber(value)}`;
}

/** -0.5 → "-50%"，0.2 → "+20%"，0.004 → "+0.4%" */
export function formatPct(pct: number | null): string {
  if (pct === null) return "—";
  const value = pct * 100;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const text = abs > 0 && abs < 1 ? abs.toFixed(1) : Math.round(abs).toString();
  return `${sign}${text}%`;
}

function compact(tokens: number, decimal: number, binary: number): number {
  if (tokens % decimal === 0) return tokens / decimal;
  if (tokens % binary === 0) return tokens / binary;
  return Math.round((tokens / decimal) * 10) / 10;
}

/** 128000 → "128K"，131072 → "128K"，1048576 → "1M"，2000000 → "2M" */
export function formatTokens(tokens: number | null): string {
  if (tokens === null) return "—";
  if (tokens >= 1_000_000) return `${compact(tokens, 1_000_000, 1_048_576)}M`;
  if (tokens >= 1_000) return `${compact(tokens, 1_000, 1_024)}K`;
  return tokens.toString();
}
