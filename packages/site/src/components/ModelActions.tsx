/**
 * 模型页上的「收藏」「加入对比」按钮（DEV §3.20）。对比列表够 2 个时显示「去对比」。
 */
import { useStore } from "@nanostores/react";
import { createT } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { MAX_COMPARE, MIN_COMPARE, compareSearch } from "../lib/compare";
import { pageHref } from "../lib/url";
import { $compare, $favorites, toggleCompare, toggleFavorite } from "../stores/collections";
import { useCollections } from "./CollectionButtons";

export interface ModelActionsProps {
  readonly slug: string;
  readonly locale: Locale;
  readonly base: string;
}

export function ModelActions({ slug, locale, base }: ModelActionsProps) {
  const t = createT(locale);
  useCollections();
  const favorited = useStore($favorites).includes(slug);
  const list = useStore($compare);
  const compared = list.includes(slug);
  const full = !compared && list.length >= MAX_COMPARE;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="model-actions">
      <button
        type="button"
        className="btn"
        aria-pressed={favorited}
        onClick={() => toggleFavorite(slug)}
        data-testid="model-fav"
      >
        {t(favorited ? "model.favorited" : "model.favorite")}
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={compared}
        disabled={full}
        title={full ? t("compare.full", { max: MAX_COMPARE }) : undefined}
        onClick={() => toggleCompare(slug)}
        data-testid="model-compare"
      >
        {t(compared ? "model.compared" : "model.compare")}
      </button>
      {list.length >= MIN_COMPARE && (
        <a
          className="btn btn-primary"
          href={`${pageHref(base, locale, "compare/")}${compareSearch(list)}`}
          data-testid="model-go-compare"
        >
          {t("model.goCompare", { count: list.length })}
        </a>
      )}
    </div>
  );
}
