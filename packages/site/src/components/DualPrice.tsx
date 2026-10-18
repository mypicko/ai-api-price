/**
 * PriceCell 的价格部分：同时渲染 USD / CNY 两份，由 <html data-currency> 决定显示哪份。
 * 原币种不加 ≈；换算价格加 ≈，并悬停提示汇率（STYLE §10.1）。
 * 可以在 Astro 里静态使用（零 JS），也可以在交互组件里使用。
 */
import type { Currency } from "@aipb/shared";
import type { Locale } from "../lib/locale";
import { t } from "../lib/i18n";
import { formatPrice } from "../lib/shared-client";

export interface DualPriceProps {
  readonly currency: Currency;
  readonly usd: number | null;
  readonly cny: number | null;
  readonly locale: Locale;
  /** 换算提示，例如「按 1 USD = 7.10 CNY 换算（2026-10-18）」 */
  readonly fxNote: string;
  /** 0 显示成「免费」徽章（表格里用）；false 时显示成文字 */
  readonly freeBadge?: boolean;
}

const CURRENCIES: readonly Currency[] = ["USD", "CNY"];

export function FreeBadge({ locale }: { readonly locale: Locale }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-free-bg px-1.5 py-0.5 text-micro text-free">
      {t(locale, "badge.free")}
    </span>
  );
}

export function DualPrice({
  currency,
  usd,
  cny,
  locale,
  fxNote,
  freeBadge = true,
}: DualPriceProps) {
  return (
    <>
      {CURRENCIES.map((c) => {
        const value = c === "USD" ? usd : cny;
        const className = `cur-${c}`;
        if (value === null) {
          return (
            <span key={c} className={`${className} text-text-faint`} title={t(locale, "table.na")}>
              —
            </span>
          );
        }
        if (value === 0 && freeBadge) {
          return (
            <span key={c} className={className}>
              <FreeBadge locale={locale} />
            </span>
          );
        }
        const approx = c !== currency;
        return (
          <span key={c} className={`${className} tabular`} title={approx ? fxNote : undefined}>
            {formatPrice(value, c, { locale, approx })}
          </span>
        );
      })}
    </>
  );
}

/** 表头单位：「$/1M」「¥/1M」两份 */
export function DualUnit({ locale }: { readonly locale: Locale }) {
  return (
    <>
      <span className="cur-USD">{t(locale, "table.unit", { symbol: "$" })}</span>
      <span className="cur-CNY">{t(locale, "table.unit", { symbol: "¥" })}</span>
    </>
  );
}
