/**
 * 价格总榜（STYLE §8）。首屏在构建时渲染成 HTML，水合后启用排序、筛选和 URL 同步。
 * 默认按模型聚合（每个模型一行：最低价 + 平台数，可展开各平台报价），也可切到逐条报价；
 * 默认按混合价升序；超过 100 行时分页「显示更多」。
 */
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { groupByModel, sortGroups, type ModelGroup } from "../lib/aggregate";
import type { Locale } from "../lib/locale";
import {
  createT,
  formatDateTime,
  formatDateTimeWithZone,
  formatShortDateTime,
  type MessageKey,
} from "../lib/i18n";
import { formatTokens } from "../lib/shared-client";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  DEFAULT_VIEW,
  PAGE_SIZE,
  ariaSort,
  filterRows,
  modelOptions,
  nextSort,
  parseTableState,
  serializeTableState,
  sortRows,
  type SortKey,
  type TableFilters,
  type TableRow,
  type TableSort,
  type TableView,
} from "../lib/table";
import { modelPath, pageHref } from "../lib/url";
import { PctBadge, StatusBadge } from "./ChangeBadge";
import { DualPrice, DualUnit } from "./DualPrice";
import { FilterBar, type Option } from "./FilterBar";
import { MediaMatches } from "./MediaMatches";
import { CompareCheck, FavoriteStar, useCollections } from "./CollectionButtons";
import { CompareTray } from "./CompareTray";
import { useStore } from "@nanostores/react";
import { $favorites } from "../stores/collections";
import type { MediaKind } from "@aipb/shared";
import type { MediaSearchItem } from "../lib/media";

export interface PriceTableProps {
  readonly rows: readonly TableRow[];
  readonly locale: Locale;
  readonly base: string;
  readonly nowIso: string;
  readonly fxNote: string;
  readonly vendors: readonly Option[];
  readonly platforms: readonly Option[];
  /** 视频/图像报价：搜索命中时在价格榜上方列出（统一搜索入口） */
  readonly media?: readonly MediaSearchItem[];
  /** 首页先只有前 100 个模型（partial），全量数据到达后为 done；默认 done */
  readonly loading?: "partial" | "done" | "error";
  /** 搜索命中视频/图像时，切换到价格榜对应标签 */
  readonly onSelectMedia?: (kind: MediaKind, query: string) => void;
}

interface Column {
  readonly key: SortKey;
  readonly label: MessageKey;
  readonly numeric: boolean;
  readonly unit?: boolean;
  /** md 断点（640~1023px）隐藏 */
  readonly hideMd?: boolean;
  /** 手机端（< 640px）隐藏，信息并入第一列 */
  readonly hideSm?: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: "model", label: "table.column.model", numeric: false },
  { key: "vendor", label: "table.column.vendor", numeric: false, hideSm: true },
  { key: "platform", label: "table.column.platform", numeric: false },
  { key: "input", label: "table.column.input", numeric: true, unit: true },
  { key: "output", label: "table.column.output", numeric: true, unit: true },
  { key: "cacheRead", label: "table.column.cacheRead", numeric: true, unit: true, hideMd: true },
  { key: "context", label: "table.column.context", numeric: true },
  { key: "change7d", label: "table.column.change7d", numeric: true, hideMd: true },
  { key: "updated", label: "table.column.updated", numeric: true },
];

const HIDE_MD = "md:max-lg:hidden";
const STICKY = "pt-sticky";

function SortHeader({
  column: baseColumn,
  sort,
  locale,
  view,
  onSort,
}: {
  column: Column;
  sort: TableSort;
  locale: Locale;
  view: TableView;
  onSort: (key: SortKey) => void;
}) {
  const t = createT(locale);
  // 聚合视图下「平台」列显示最低价平台，排序按平台数
  const column: Column =
    view === "models" && baseColumn.key === "platform"
      ? { ...baseColumn, label: "table.column.cheapest" }
      : baseColumn;
  const state = ariaSort(sort, column.key);
  const arrow = state === "ascending" ? "▲" : state === "descending" ? "▼" : "";
  const first = column.key === "model";
  return (
    <th
      scope="col"
      aria-sort={state}
      className={`sticky top-0 z-20 border-b border-border bg-surface px-3 py-2 text-small font-semibold whitespace-nowrap text-text-muted ${
        column.numeric ? "text-right" : "text-left"
      } ${column.hideMd ? HIDE_MD : ""} ${column.hideSm ? "max-sm:hidden" : ""} ${first ? "left-0 z-30" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 rounded-sm hover:text-text ${column.numeric ? "flex-row-reverse" : ""} ${state === "none" ? "" : "text-text"}`}
        title={t("table.sortBy", { column: t(column.label) })}
      >
        <span>
          {t(column.label)}
          {column.unit && (
            <span className="ml-1 font-normal text-text-faint">
              <DualUnit locale={locale} />
            </span>
          )}
        </span>
        <span aria-hidden="true" className="inline-block w-2.5 text-[10px] text-accent">
          {arrow}
        </span>
      </button>
    </th>
  );
}

function PriceTd({
  row,
  index,
  props,
  hideMd,
}: {
  row: TableRow;
  index: 0 | 1 | 2;
  props: PriceTableProps;
  hideMd?: boolean;
}) {
  return (
    <td className={`pt-num ${hideMd ? HIDE_MD : ""}`}>
      <DualPrice
        currency={row.currency}
        usd={row.usd[index]}
        cny={row.cny[index]}
        locale={props.locale}
        fxNote={props.fxNote}
      />
    </td>
  );
}

interface RowProps {
  row: TableRow;
  props: PriceTableProps;
  /** 聚合视图展开后的子行：第一列显示平台名，不重复模型名 */
  nested?: boolean;
  /** 平台列追加的内容（平台数按钮） */
  platformExtra?: ReactNode;
}

function NestedModelCell({ row }: { row: TableRow }) {
  return (
    <th scope="row" className={`${STICKY} pr-3 pl-7 text-text-muted`}>
      <span aria-hidden="true" className="mr-1 text-text-faint">
        └
      </span>
      {row.platformName}
    </th>
  );
}

function Row({ row, props, nested = false, platformExtra }: RowProps) {
  const t = createT(props.locale);
  const href = pageHref(props.base, props.locale, modelPath(row.modelSlug));
  const navigate = (event: MouseEvent<HTMLTableRowElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select") || window.getSelection()?.toString()) return;
    window.location.href = href;
  };
  return (
    <tr
      className={`group pt-row ${nested ? "h-10 bg-surface/40" : "h-13 sm:h-11"}`}
      onClick={navigate}
      data-id={row.id}
      data-nested={nested ? "true" : undefined}
    >
      {nested ? (
        <NestedModelCell row={row} />
      ) : (
        <th scope="row" className={`${STICKY} px-3`}>
          <div className="flex items-center gap-1.5">
            <CompareCheck slug={row.modelSlug} name={row.displayName} locale={props.locale} />
            <FavoriteStar slug={row.modelSlug} name={row.displayName} locale={props.locale} />
            <a href={href} className="pt-name">
              {row.displayName}
            </a>
            {row.hasTiers && (
              <span
                className="shrink-0 rounded-sm border border-border px-1 text-micro text-text-muted"
                title={t("table.tiered")}
              >
                {t("model.tiers")}
              </span>
            )}
            {row.status === "missing" && <StatusBadge kind="missing" locale={props.locale} />}
          </div>
          <div className="pt-sub hidden font-mono text-text-faint sm:block">{row.model}</div>
          <div className="pt-sub text-text-muted sm:hidden">{row.vendorName}</div>
        </th>
      )}
      <td className="px-3 whitespace-nowrap max-sm:hidden">{nested ? "" : row.vendorName}</td>
      <td className="px-3 whitespace-nowrap text-text-muted">
        <div className="flex items-center gap-2">
          {nested ? null : <span>{row.platformName}</span>}
          {platformExtra}
        </div>
      </td>
      <PriceTd row={row} index={0} props={props} />
      <PriceTd row={row} index={1} props={props} />
      <PriceTd row={row} index={2} props={props} hideMd />
      <td className="pt-num">
        {row.contextWindow === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          formatTokens(row.contextWindow)
        )}
      </td>
      <td className={`pt-num ${HIDE_MD}`}>
        <PctBadge pct={row.change7d} locale={props.locale} />
      </td>
      <td className="pt-num text-small text-text-muted">
        {row.stale && (
          <span
            className="mr-1 text-warn"
            role="img"
            aria-label={t("table.stale", { date: formatDateTime(row.fetchedAt, props.locale) })}
            title={t("table.stale", { date: formatDateTime(row.fetchedAt, props.locale) })}
          >
            ⚠
          </span>
        )}
        <time dateTime={row.fetchedAt} title={formatDateTimeWithZone(row.fetchedAt, props.locale)}>
          {formatShortDateTime(row.fetchedAt, props.locale)}
        </time>
      </td>
    </tr>
  );
}

interface TableStateHook {
  readonly filters: TableFilters;
  readonly sort: TableSort;
  readonly view: TableView;
  readonly setFilters: (f: TableFilters) => void;
  readonly setSort: (s: TableSort) => void;
  readonly setView: (v: TableView) => void;
}

function useTableState(): TableStateHook {
  const [filters, setFilters] = useState<TableFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TableSort>(DEFAULT_SORT);
  const [view, setView] = useState<TableView>(DEFAULT_VIEW);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const state = parseTableState(window.location.search);
    setFilters(state.filters);
    setSort(state.sort);
    setView(state.view);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const query = serializeTableState({ filters, sort, view });
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filters, sort, view, ready]);
  return { filters, sort, view, setFilters, setSort, setView };
}

function ViewToggle(props: { view: TableView; locale: Locale; onChange: (v: TableView) => void }) {
  const t = createT(props.locale);
  return (
    <div role="group" aria-label={t("table.view")} className="segmented" data-testid="view-toggle">
      {(["models", "offers"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={props.view === v}
          onClick={() => props.onChange(v)}
        >
          {t(`table.view.${v}`)}
        </button>
      ))}
    </div>
  );
}

function GroupRows(props: {
  group: ModelGroup;
  expanded: boolean;
  onToggle: () => void;
  table: PriceTableProps;
}) {
  const { group, expanded, table } = props;
  const t = createT(table.locale);
  const count = group.platformCount;
  const toggle =
    group.offerings.length > 1 ? (
      <button
        type="button"
        className="shrink-0 rounded-sm border border-border px-1.5 text-micro whitespace-nowrap text-text-muted hover:border-accent hover:text-accent"
        aria-expanded={expanded}
        aria-label={expanded ? t("table.collapse") : t("table.expand", { count })}
        data-testid="platform-count"
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
      >
        {t("table.platformCount", { count })} {expanded ? "▴" : "▾"}
      </button>
    ) : null;
  return (
    <>
      <Row row={group.best} props={table} platformExtra={toggle} />
      {expanded &&
        group.offerings.map((row) => <Row key={row.id} row={row} props={table} nested />)}
    </>
  );
}

export function PriceTable(props: PriceTableProps) {
  const { rows, locale } = props;
  const t = createT(locale);
  const { filters, sort, view, setFilters, setSort, setView } = useTableState();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  useCollections();
  const favorites = useStore($favorites);
  const [favOnly, setFavOnly] = useState(false);
  const filtered = useMemo(() => {
    const result = filterRows(rows, filters);
    if (!favOnly) return result;
    const keep = new Set(favorites);
    return result.filter((r) => keep.has(r.modelSlug));
  }, [rows, filters, favOnly, favorites]);
  const names = useMemo(
    () => new Map(rows.map((r) => [r.modelSlug, r.displayName] as const)),
    [rows],
  );
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const groups = useMemo(() => sortGroups(groupByModel(filtered), sort), [filtered, sort]);
  const total = view === "models" ? groups.length : sorted.length;
  const toggleGroup = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const models = useMemo(
    () => modelOptions(rows, filters.vendors, locale),
    [rows, filters.vendors, locale],
  );
  const body: ReactNode =
    view === "models"
      ? groups
          .slice(0, visible)
          .map((group) => (
            <GroupRows
              key={group.id}
              group={group}
              expanded={expanded.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              table={props}
            />
          ))
      : sorted.slice(0, visible).map((row) => <Row key={row.id} row={row} props={props} />);
  const onFilters = (next: TableFilters): void => {
    setFilters(next);
    setVisible(PAGE_SIZE);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape")
      (event.target as HTMLElement).closest("details")?.removeAttribute("open");
  };
  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown}>
      <FilterBar
        locale={locale}
        filters={filters}
        vendors={props.vendors}
        models={models}
        platforms={props.platforms}
        onChange={onFilters}
      />
      {props.media && (
        <MediaMatches
          items={props.media}
          query={filters.q}
          locale={locale}
          base={props.base}
          fxNote={props.fxNote}
          {...(props.onSelectMedia ? { onSelect: props.onSelectMedia } : {})}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-text-muted" aria-live="polite" data-testid="result-count">
          {view === "models"
            ? t("table.resultCount.models", { models: groups.length, count: sorted.length })
            : t("table.resultCount", { count: sorted.length })}
          {props.loading === "partial" && (
            <span data-testid="board-partial"> · {t("board.partial")}</span>
          )}
          {props.loading === "error" && (
            <span className="text-warn" data-testid="board-error">
              {" "}
              · {t("board.loadError")}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-table">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={favOnly}
              onChange={(e) => {
                setFavOnly(e.target.checked);
                setVisible(PAGE_SIZE);
              }}
              data-testid="fav-only"
            />
            {t("fav.only", { count: favorites.length })}
          </label>
          <ViewToggle
            view={view}
            locale={locale}
            onChange={(next) => {
              setView(next);
              setVisible(PAGE_SIZE);
            }}
          />
        </div>
      </div>
      <div
        className="overflow-x-auto rounded-lg border border-border sm:max-h-[78vh] sm:overflow-y-auto"
        data-testid="table-scroll"
      >
        <table className="w-full border-collapse" data-testid="price-table">
          <caption className="sr-only">{t("table.caption")}</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <SortHeader
                  key={c.key}
                  column={c}
                  sort={sort}
                  locale={locale}
                  view={view}
                  onSort={(key) => setSort(nextSort(sort, key))}
                />
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-text-muted">
            <p>{t(favOnly && favorites.length === 0 ? "fav.empty" : "table.empty")}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                onFilters(DEFAULT_FILTERS);
                setFavOnly(false);
              }}
            >
              {t("table.resetFilters")}
            </button>
          </div>
        )}
      </div>
      {total > visible && (
        <button
          type="button"
          className="btn self-center"
          onClick={() => setVisible(visible + PAGE_SIZE)}
        >
          {t("table.showMore", { count: total - visible })}
        </button>
      )}
      <CompareTray locale={locale} base={props.base} names={names} />
    </div>
  );
}
