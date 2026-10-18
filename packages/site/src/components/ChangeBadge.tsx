/**
 * 涨跌/状态徽章（STYLE §7.1）：▼ -50% / ▲ +20% / 新 / 已下架。
 * 颜色不能单独表达含义，所以同时带箭头和正负号（STYLE §4.3）。
 */
import type { ChangeType } from "@aipb/shared";
import type { ReactNode } from "react";
import type { Locale } from "../lib/locale";
import { t } from "../lib/i18n";
import { formatPct } from "../lib/shared-client";

const TONE = {
  down: "bg-down-bg text-down",
  up: "bg-up-bg text-up",
  new: "bg-new-bg text-new",
  warn: "bg-warn-bg text-warn",
  neutral: "bg-surface-hover text-text-muted",
} as const;

type Tone = keyof typeof TONE;

function Badge({ tone, label, children }: { tone: Tone; label?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-micro tabular ${TONE[tone]}`}
      aria-label={label}
      title={label}
    >
      {children}
    </span>
  );
}

/** 百分比变化徽章；null 显示 —，0 显示灰色 0% */
export function PctBadge({
  pct,
  locale,
}: {
  readonly pct: number | null;
  readonly locale: Locale;
}) {
  if (pct === null) return <span className="text-text-faint">—</span>;
  if (pct === 0) return <span className="text-small tabular text-text-muted">0%</span>;
  const down = pct < 0;
  return (
    <Badge
      tone={down ? "down" : "up"}
      label={`${t(locale, down ? "badge.down" : "badge.up")} ${formatPct(pct)}`}
    >
      <span aria-hidden="true">{down ? "▼" : "▲"}</span>
      {formatPct(pct)}
    </Badge>
  );
}

const TYPE_TONE: Readonly<Record<ChangeType, Tone>> = {
  price_down: "down",
  price_up: "up",
  new_model: "new",
  removed: "neutral",
  restored: "new",
  context_change: "neutral",
};

const TYPE_ICON: Readonly<Record<ChangeType, string>> = {
  price_down: "▼",
  price_up: "▲",
  new_model: "＋",
  removed: "×",
  restored: "↺",
  context_change: "↔",
};

/** 事件类型徽章：▼ 降价 / ▲ 涨价 / ＋ 新模型 … */
export function TypeBadge({
  type,
  locale,
}: {
  readonly type: ChangeType;
  readonly locale: Locale;
}) {
  return (
    <Badge tone={TYPE_TONE[type]}>
      <span aria-hidden="true">{TYPE_ICON[type]}</span>
      {t(locale, `change.type.${type}`)}
    </Badge>
  );
}

export function StatusBadge({
  kind,
  locale,
}: {
  readonly kind: "removed" | "missing" | "new";
  readonly locale: Locale;
}) {
  const tone: Tone = kind === "new" ? "new" : kind === "missing" ? "warn" : "neutral";
  const key = kind === "new" ? "badge.new" : kind === "missing" ? "badge.missing" : "badge.removed";
  return <Badge tone={tone}>{t(locale, key)}</Badge>;
}
