/**
 * 首页统一搜索：在文本标签下，关键字命中视频/图像模型时列出来，点击切换到价格榜对应标签（DEV §3.13）。
 * 视频/图像按秒 / 按张计价，不进文本表格，这里只做入口。
 */
import { useMemo, type MouseEvent } from "react";
import type { MediaKind } from "@aipb/shared";
import type { Locale } from "../lib/locale";
import { createT } from "../lib/i18n";
import { mediaSearchHref, searchMedia, type MediaSearchItem } from "../lib/media";
import { DualPrice } from "./DualPrice";

export interface MediaMatchesProps {
  readonly items: readonly MediaSearchItem[];
  readonly query: string;
  readonly locale: Locale;
  readonly base: string;
  readonly fxNote: string;
  /** 由价格榜提供：在当前页切换标签，不刷新页面；没有时按普通链接跳转 */
  readonly onSelect?: (kind: MediaKind, query: string) => void;
}

const MAX_SHOWN = 6;

function selectHandler(props: MediaMatchesProps, kind: MediaKind, query: string) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!props.onSelect || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    props.onSelect(kind, query);
  };
}

function Item({ item, props }: { item: MediaSearchItem; props: MediaMatchesProps }) {
  const t = createT(props.locale);
  const unit = item.unit === "per_image" ? "media.unit.image" : "media.unit.second";
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <a
        href={mediaSearchHref(props.base, props.locale, item.displayName, item.kind)}
        onClick={selectHandler(props, item.kind, item.displayName)}
        className="font-medium hover:text-accent hover:underline"
      >
        {item.displayName}
      </a>
      <span className="text-small text-text-muted">
        {t(`media.tab.${item.kind}`)} · {item.vendorName} · {item.platformName}
      </span>
      <span className="tabular">
        <DualPrice
          currency={item.currency}
          usd={item.usd}
          cny={item.cny}
          locale={props.locale}
          fxNote={props.fxNote}
          freeBadge={false}
        />
        <span className="text-small text-text-faint">{t(unit, { symbol: "" })}</span>
      </span>
    </li>
  );
}

export function MediaMatches(props: MediaMatchesProps) {
  const { items, query, locale } = props;
  const t = createT(locale);
  const hits = useMemo(() => searchMedia(items, query), [items, query]);
  const first = hits[0];
  if (!first) return null;
  const rest = hits.length - MAX_SHOWN;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
      data-testid="media-matches"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-small font-semibold">
          {t("home.mediaMatches", { count: hits.length, query: query.trim() })}
        </h3>
        <a
          href={mediaSearchHref(props.base, locale, query, first.kind)}
          onClick={selectHandler(props, first.kind, query)}
          className="text-small text-accent hover:underline"
        >
          {t("home.mediaMatches.viewAll")}
        </a>
      </div>
      <ul className="flex flex-col gap-1 text-table">
        {hits.slice(0, MAX_SHOWN).map((item) => (
          <Item key={item.id} item={item} props={props} />
        ))}
      </ul>
      {rest > 0 && (
        <p className="text-small text-text-muted">{t("home.mediaMatches.more", { count: rest })}</p>
      )}
    </section>
  );
}
