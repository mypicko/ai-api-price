/**
 * 头部的三个切换（STYLE §7.1）：币种 / 语言 / 主题。一个 island 里放三个，减少水合次数。
 */
import type { Currency } from "@aipb/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useState, type MouseEvent } from "react";
import { DEFAULT_CURRENCY, HTML_LANG, type Locale } from "../lib/locale";
import { createT } from "../lib/i18n";
import {
  $currency,
  $theme,
  applyTheme,
  setCurrency,
  setLangPref,
  setTheme,
  type ThemePref,
} from "../stores/prefs";

export interface HeaderControlsProps {
  readonly locale: Locale;
  /** 另一种语言的同一页面（含 base） */
  readonly altHref: string;
}

const CURRENCIES: readonly { id: Currency; label: string }[] = [
  { id: "CNY", label: "¥ CNY" },
  { id: "USD", label: "$ USD" },
];

const THEMES: readonly {
  id: ThemePref;
  icon: string;
  label: "toggle.theme.light" | "toggle.theme.dark" | "toggle.theme.system";
}[] = [
  { id: "light", icon: "☀", label: "toggle.theme.light" },
  { id: "dark", icon: "☾", label: "toggle.theme.dark" },
  { id: "system", icon: "◐", label: "toggle.theme.system" },
];

/** 水合完成前使用和服务端一致的值，避免水合不一致 */
function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function CurrencyToggle({ locale }: { readonly locale: Locale }) {
  const t = createT(locale);
  const stored = useStore($currency);
  const hydrated = useHydrated();
  const current = (hydrated ? stored : null) ?? DEFAULT_CURRENCY[locale];
  return (
    <div
      role="group"
      aria-label={t("toggle.currency")}
      className="segmented"
      data-testid="currency-toggle"
    >
      {CURRENCIES.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={current === c.id}
          onClick={() => setCurrency(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle({ locale }: { readonly locale: Locale }) {
  const t = createT(locale);
  const stored = useStore($theme);
  const theme: ThemePref = useHydrated() ? stored : "system";
  useEffect(() => {
    if (theme !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
  return (
    <div
      role="group"
      aria-label={t("toggle.theme")}
      className="segmented"
      data-testid="theme-toggle"
    >
      {THEMES.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={theme === item.id}
          aria-label={t(item.label)}
          title={t(item.label)}
          onClick={() => setTheme(item.id)}
        >
          <span aria-hidden="true">{item.icon}</span>
        </button>
      ))}
    </div>
  );
}

export function LangToggle({ locale, altHref }: HeaderControlsProps) {
  const t = createT(locale);
  const target: Locale = locale === "zh" ? "en" : "zh";
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    setLangPref(target);
    event.currentTarget.href = `${altHref}${window.location.search}`;
  };
  return (
    <a
      href={altHref}
      hrefLang={HTML_LANG[target]}
      lang={HTML_LANG[target]}
      onClick={onClick}
      className="btn h-8 px-3 text-small"
      aria-label={`${t("toggle.language")}: ${t("toggle.lang.switchTo")}`}
      data-testid="lang-toggle"
    >
      {t("toggle.lang.switchTo")}
    </a>
  );
}

export function HeaderControls(props: HeaderControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CurrencyToggle locale={props.locale} />
      <ThemeToggle locale={props.locale} />
      <LangToggle {...props} />
    </div>
  );
}
