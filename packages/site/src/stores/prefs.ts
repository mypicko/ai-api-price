/**
 * 共享偏好状态（STYLE §7.2）：币种、主题、语言。变化时同步到 localStorage 和 <html> 属性。
 * localStorage 只存偏好（安全项 S11）。
 */
import type { Currency } from "@aipb/shared";
import { atom } from "nanostores";
import { isCurrency, isLocale, type Locale } from "../lib/locale";

export type ThemePref = "light" | "dark" | "system";

export const STORAGE_KEYS = {
  currency: "aipb.currency",
  theme: "theme",
  lang: "aipb.lang",
} as const;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (error) {
    console.warn("localStorage 不可用，偏好不会保存", error);
    return null;
  }
}

function initialCurrency(fallback: Currency): Currency {
  if (typeof document === "undefined") return fallback;
  const value = document.documentElement.dataset["currency"];
  return isCurrency(value) ? value : fallback;
}

function initialTheme(): ThemePref {
  const value = storage()?.getItem(STORAGE_KEYS.theme);
  return value === "light" || value === "dark" ? value : "system";
}

/** SSR 时为 null；浏览器里由 <html data-currency>（内联脚本已经设置好）初始化 */
export const $currency = atom<Currency | null>(
  typeof document === "undefined" ? null : initialCurrency("USD"),
);
export const $theme = atom<ThemePref>(typeof window === "undefined" ? "system" : initialTheme());

export function setCurrency(currency: Currency): void {
  $currency.set(currency);
  document.documentElement.dataset["currency"] = currency;
  storage()?.setItem(STORAGE_KEYS.currency, currency);
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function applyTheme(pref: ThemePref): void {
  const dark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(pref: ThemePref): void {
  $theme.set(pref);
  const store = storage();
  if (pref === "system") store?.removeItem(STORAGE_KEYS.theme);
  else store?.setItem(STORAGE_KEYS.theme, pref);
  applyTheme(pref);
}

export function setLangPref(locale: Locale): void {
  if (isLocale(locale)) storage()?.setItem(STORAGE_KEYS.lang, locale);
}

/** 当前是否是暗色（图表用） */
export function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}
