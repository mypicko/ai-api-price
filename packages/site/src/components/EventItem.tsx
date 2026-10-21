/**
 * 一条变动事件的展示（今日变动卡片、变动日志、模型详情页共用）。
 * 抓来的文本（模型名等）只作为纯文本渲染（安全项 S5）。
 */
import type { ChangeField } from "@aipb/shared";
import type { EventView } from "../lib/views";
import type { Locale } from "../lib/locale";
import {
  formatDateTime,
  formatDateTimeWithZone,
  formatShortDateTime,
  formatTime,
  t,
  type MessageKey,
} from "../lib/i18n";
import { formatPct, formatPrice, formatTokens } from "../lib/shared-client";
import { modelPath, pageHref } from "../lib/url";
import { PctBadge, TypeBadge } from "./ChangeBadge";

export type { EventView };

function fieldText(
  field: ChangeField,
  value: number | null,
  event: EventView,
  locale: Locale,
): string {
  return field.field === "contextWindow"
    ? formatTokens(value)
    : formatPrice(value, event.currency, { locale });
}

export function EventDetail({
  event,
  locale,
}: {
  readonly event: EventView;
  readonly locale: Locale;
}) {
  if (event.type === "new_model" && event.current) {
    return (
      <span className="tabular text-text-muted">
        {t(locale, "change.field.input")}{" "}
        {formatPrice(event.current.input, event.currency, { locale })} ·{" "}
        {t(locale, "change.field.output")}{" "}
        {formatPrice(event.current.output, event.currency, { locale })}
      </span>
    );
  }
  if (event.fields.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {event.fields.map((f) => (
        <li key={f.field} className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular">
          <span className="text-text-muted">
            {t(locale, `change.field.${f.field}` as MessageKey)}
          </span>
          <span>
            <span className="text-text-muted line-through decoration-text-faint">
              {fieldText(f, f.old, event, locale)}
            </span>
            <span aria-hidden="true" className="px-1 text-text-faint">
              →
            </span>
            <span className="sr-only"> → </span>
            <span className="font-medium">{fieldText(f, f.new, event, locale)}</span>
          </span>
          {f.field !== "contextWindow" && <PctBadge pct={f.pct} locale={locale} />}
          {f.field === "contextWindow" && f.pct !== null && (
            <span className="text-small text-text-muted">{formatPct(f.pct)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface EventItemProps {
  readonly event: EventView;
  readonly locale: Locale;
  readonly base: string;
  /** 卡片样式（首页今日变动） */
  readonly variant?: "card" | "row";
  /** 行样式下同时显示日期（模型详情页） */
  readonly showDate?: boolean;
}

export function EventItem({
  event,
  locale,
  base,
  variant = "row",
  showDate = false,
}: EventItemProps) {
  const href = pageHref(base, locale, modelPath(event.modelSlug));
  const time =
    variant === "card"
      ? formatShortDateTime(event.detectedAt, locale)
      : showDate
        ? formatDateTime(event.detectedAt, locale)
        : formatTime(event.detectedAt);
  return (
    <div
      className={
        variant === "card"
          ? "card flex h-full flex-col gap-3 p-4"
          : "flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4"
      }
    >
      <div
        className={
          variant === "card"
            ? "flex items-center justify-between gap-2"
            : `flex shrink-0 items-center gap-3 ${showDate ? "sm:w-64" : "sm:w-40"}`
        }
      >
        <TypeBadge type={event.type} locale={locale} />
        <time
          dateTime={event.detectedAt}
          title={formatDateTimeWithZone(event.detectedAt, locale)}
          className="text-small tabular text-text-muted"
        >
          {time}
        </time>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-table">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <a href={href} className="font-semibold hover:text-accent hover:underline">
            {event.displayName}
          </a>
          <span className="text-small text-text-muted">
            {event.vendorName} · {event.platformName}
          </span>
          {event.confirmedFromQuarantine && (
            <span className="text-small text-text-faint">{t(locale, "change.fromQuarantine")}</span>
          )}
        </div>
        <EventDetail event={event} locale={locale} />
      </div>
    </div>
  );
}
