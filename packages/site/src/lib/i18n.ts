/**
 * i18n 工具（DEV §3.12、STYLE §10）。客户端组件也会用到，所以这里不能引入 zod。
 */
import en from "../i18n/en.json";
import zh from "../i18n/zh.json";
import type { Locale } from "./locale";

export type MessageKey = keyof typeof zh;
export type Messages = Readonly<Record<MessageKey, string>>;

const MESSAGES: Readonly<Record<Locale, Messages>> = { zh, en };

export const TIME_ZONE = "Asia/Shanghai";
const DAY_MS = 86_400_000;

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** {name} 占位替换；变量缺失时保留占位，方便发现问题 */
export function interpolate(
  template: string,
  vars: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Readonly<Record<string, string | number>>,
): string {
  return interpolate(MESSAGES[locale][key], vars);
}

export function createT(
  locale: Locale,
): (key: MessageKey, vars?: Readonly<Record<string, string | number>>) => string {
  return (key, vars) => t(locale, key, vars);
}

interface ShanghaiParts {
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
}

const PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function shanghaiParts(iso: string): ShanghaiParts {
  const parts = PARTS_FORMAT.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** ISO 时间 → 北京时间日期 YYYY-MM-DD；纯日期（YYYY-MM-DD）原样返回 */
export function shanghaiDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const p = shanghaiParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** 完整日期：2026年10月19日 / Oct 19, 2026 */
export function formatDate(iso: string, locale: Locale): string {
  const [year = "", month = "", day = ""] = shanghaiDate(iso).split("-");
  if (locale === "zh") return `${year}年${Number(month)}月${Number(day)}日`;
  return `${EN_MONTHS[Number(month) - 1] ?? month} ${Number(day)}, ${year}`;
}

/** 表格/列表日期：10-19 / Oct 19 */
export function formatShortDate(iso: string, locale: Locale): string {
  const [, month = "", day = ""] = shanghaiDate(iso).split("-");
  if (locale === "zh") return `${month}-${day}`;
  return `${EN_MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
}

/** 北京时间 HH:mm */
export function formatTime(iso: string): string {
  const p = shanghaiParts(iso);
  return `${p.hour}:${p.minute}`;
}

/** 两个北京时间日期之间相差的天数（b - a） */
export function daysBetween(a: string, b: string): number {
  const toUtc = (d: string): number => Date.parse(`${shanghaiDate(d)}T00:00:00Z`);
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 更新时间：今天 08:04 / 昨天 08:04 / 3 天前 */
export function formatRelative(iso: string, nowIso: string, locale: Locale): string {
  const days = daysBetween(iso, nowIso);
  if (days <= 0) return t(locale, "time.today", { time: formatTime(iso) });
  if (days === 1) return t(locale, "time.yesterday", { time: formatTime(iso) });
  return t(locale, "time.daysAgo", { days });
}

/** 完整时间：2026年10月19日 08:04 / Oct 19, 2026 08:04 */
export function formatDateTime(iso: string, locale: Locale): string {
  return `${formatDate(iso, locale)} ${formatTime(iso)}`;
}

function trimNumber(value: number, digits: number): string {
  return Number(value.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** 计算器用量：中文 3,000 万 / 1.5 亿；英文 30M / 1.5B（STYLE §10.2） */
export function formatTokenVolume(tokens: number, locale: Locale): string {
  const abs = Math.abs(tokens);
  if (locale === "zh") {
    if (abs >= 1e8) return `${trimNumber(tokens / 1e8, 2)} 亿 tokens`;
    if (abs >= 1e4) return `${trimNumber(tokens / 1e4, 2)} 万 tokens`;
    return `${trimNumber(tokens, 0)} tokens`;
  }
  if (abs >= 1e9) return `${trimNumber(tokens / 1e9, 2)}B tokens`;
  if (abs >= 1e6) return `${trimNumber(tokens / 1e6, 2)}M tokens`;
  if (abs >= 1e3) return `${trimNumber(tokens / 1e3, 2)}K tokens`;
  return `${trimNumber(tokens, 0)} tokens`;
}
