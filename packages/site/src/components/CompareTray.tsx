/**
 * 对比栏（DEV §3.20）：勾选了模型后固定在页面底部，显示已选模型、「开始对比」和「清空」。
 */
import { useStore } from "@nanostores/react";
import { createT } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { MAX_COMPARE, MIN_COMPARE, compareSearch } from "../lib/compare";
import { pageHref } from "../lib/url";
import { $compare, setCompare, toggleCompare } from "../stores/collections";

export interface CompareTrayProps {
  readonly locale: Locale;
  readonly base: string;
  /** modelSlug → 显示名；找不到时显示 slug */
  readonly names: ReadonlyMap<string, string>;
}

export function CompareTray({ locale, base, names }: CompareTrayProps) {
  const t = createT(locale);
  const list = useStore($compare);
  if (list.length === 0) return null;
  const ready = list.length >= MIN_COMPARE;
  const href = `${pageHref(base, locale, "compare/")}${compareSearch(list)}`;
  return (
    <div
      className="card fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-3xl flex-wrap items-center gap-2 p-3 shadow-lg"
      role="region"
      aria-label={t("compare.title")}
      data-testid="compare-tray"
    >
      <span className="text-small text-text-muted tabular">
        {t("compare.tray", { count: list.length, max: MAX_COMPARE })}
      </span>
      <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {list.map((slug) => (
          <li
            key={slug}
            className="inline-flex items-center gap-1 rounded-sm bg-surface px-2 py-0.5 text-small"
          >
            <span className="max-w-40 truncate">{names.get(slug) ?? slug}</span>
            <button
              type="button"
              className="text-text-faint hover:text-text"
              aria-label={`${t("compare.removeModel")} ${names.get(slug) ?? slug}`}
              onClick={() => toggleCompare(slug)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => setCompare([])}>
        {t("compare.clear")}
      </button>
      {ready ? (
        <a className="btn btn-primary" href={href} data-testid="compare-go">
          {t("compare.go")}
        </a>
      ) : (
        <span className="text-small text-text-muted">{t("compare.needMore")}</span>
      )}
    </div>
  );
}
