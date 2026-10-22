/**
 * 价格榜、模型页上的「收藏」星标和「加入对比」勾选框（DEV §3.20）。
 * 状态在 stores/collections.ts，水合前一律显示未选中（与构建时的 HTML 一致）。
 */
import { useStore } from "@nanostores/react";
import { useEffect } from "react";
import { createT } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { MAX_COMPARE } from "../lib/compare";
import {
  $compare,
  $favorites,
  initCollections,
  toggleCompare,
  toggleFavorite,
} from "../stores/collections";

interface ItemProps {
  readonly slug: string;
  readonly name: string;
  readonly locale: Locale;
}

/** 在岛组件根部调用一次，读入 localStorage */
export function useCollections(): void {
  useEffect(() => initCollections(), []);
}

export function FavoriteStar({ slug, name, locale }: ItemProps) {
  const t = createT(locale);
  const on = useStore($favorites).includes(slug);
  const label = t(on ? "fav.remove" : "fav.add", { name });
  return (
    <button
      type="button"
      className={`fav-star ${on ? "text-warn" : "text-text-faint"}`}
      aria-pressed={on}
      aria-label={label}
      onClick={() => toggleFavorite(slug)}
      data-testid="fav-toggle"
    >
      {on ? "★" : "☆"}
    </button>
  );
}

export function CompareCheck({ slug, name, locale }: ItemProps) {
  const t = createT(locale);
  const list = useStore($compare);
  const on = list.includes(slug);
  const full = !on && list.length >= MAX_COMPARE;
  return (
    <input
      type="checkbox"
      className="cmp-check"
      checked={on}
      disabled={full}
      aria-label={t("compare.add", { name })}
      title={full ? t("compare.full", { max: MAX_COMPARE }) : undefined}
      onChange={() => toggleCompare(slug)}
      data-testid="compare-toggle"
    />
  );
}
