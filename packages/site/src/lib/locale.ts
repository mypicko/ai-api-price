import type { Currency } from "@aipb/shared";

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const HTML_LANG: Readonly<Record<Locale, string>> = { zh: "zh-CN", en: "en" };

/** 中文页默认 CNY，英文页默认 USD（DEV §3.12） */
export const DEFAULT_CURRENCY: Readonly<Record<Locale, Currency>> = { zh: "CNY", en: "USD" };

export function isLocale(value: unknown): value is Locale {
  return value === "zh" || value === "en";
}

export function isCurrency(value: unknown): value is Currency {
  return value === "USD" || value === "CNY";
}
