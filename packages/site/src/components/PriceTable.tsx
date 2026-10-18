/**
 * 价格总榜（STYLE §8）。首屏在构建时渲染成 HTML，水合后启用排序、筛选和 URL 同步。
 * 默认按混合价升序；超过 100 行时分页「显示更多」。
 */
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Locale } from "../lib/locale";
import { createT, formatDateTime, formatRelative, type MessageKey } from "../lib/i18n";
import { formatTokens } from "../lib/shared-client";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  PAGE_SIZE,
  ariaSort,
  filterRows,
  nextSort,
  parseTableState,
  serializeTableState,
  sortRows,
  type SortKey,
  type TableFilters,
  type TableRow,
  type TableSort,
} from "../lib/table";
import { modelPath, pageHref } from "../lib/url";
import { PctBadge, StatusBadge } from "./ChangeBadge";
import { DualPrice, DualUnit } from "./DualPrice";
import { FilterBar, type Option } from "./FilterBar";

export interface PriceTableProps {
  readonly rows: readonly TableRow[];
  readonly locale: Locale;
  readonly base: string;
  readonly nowIso: string;
  readonly fxNote: string;
  readonly vendors: readonly Option[];
  readonly platforms: readonly Option[];
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
const STICKY = "sticky left-0 z-10 bg-bg group-hover:bg-surface-hover";

function SortHeader({
  column,
  sort,
  locale,
  onSort,
}: {
  column: Column;
  sort: TableSort;
  locale: Locale;
  onSort: (key: SortKey) => void;
}) {
  const t = createT(locale);
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
    <td className={`px-3 text-right whitespace-nowrap tabular ${hideMd ? HIDE_MD : ""}`}>
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

function Row({ row, props }: { row: TableRow; props: PriceTableProps }) {
  const t = createT(props.locale);
  const href = pageHref(props.base, props.locale, modelPath(row.modelSlug));
  const navigate = (event: MouseEvent<HTMLTableRowElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select") || window.getSelection()?.toString()) return;
    window.location.href = href;
  };
  return (
    <tr
      className="group h-13 cursor-pointer border-b border-border text-table hover:bg-surface-hover sm:h-11"
      onClick={navigate}
      data-id={row.id}
    >
      <th
        scope="row"
        className={`${STICKY} max-w-[148px] px-3 py-1.5 text-left font-normal sm:max-w-none`}
      >
        <div className="flex items-center gap-1.5">
          <a href={href} className="truncate font-medium hover:text-accent hover:underline">
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
        <div className="hidden truncate font-mono text-micro font-normal text-text-faint sm:block">
          {row.model}
        </div>
        <div className="truncate text-micro font-normal text-text-muted sm:hidden">
          {row.vendorName}
        </div>
      </th>
      <td className="px-3 whitespace-nowrap max-sm:hidden">{row.vendorName}</td>
      <td className="px-3 whitespace-nowrap text-text-muted">{row.platformName}</td>
      <PriceTd row={row} index={0} props={props} />
      <PriceTd row={row} index={1} props={props} />
      <PriceTd row={row} index={2} props={props} hideMd />
      <td className="px-3 text-right whitespace-nowrap tabular">
        {row.contextWindow === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          formatTokens(row.contextWindow)
        )}
      </td>
      <td className={`px-3 text-right whitespace-nowrap ${HIDE_MD}`}>
        <PctBadge pct={row.change7d} locale={props.locale} />
      </td>
      <td className="px-3 text-right text-small whitespace-nowrap text-text-muted tabular">
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
        <time dateTime={row.fetchedAt}>
          {formatRelative(row.fetchedAt, props.nowIso, props.locale)}
        </time>
      </td>
    </tr>
  );
}

function useTableState(): [
  TableFilters,
  TableSort,
  (f: TableFilters) => void,
  (s: TableSort) => void,
] {
  const [filters, setFilters] = useState<TableFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<TableSort>(DEFAULT_SORT);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const state = parseTableState(window.location.search);
    setFilters(state.filters);
    setSort(state.sort);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const query = serializeTableState({ filters, sort });
    const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [filters, sort, ready]);
  return [filters, sort, setFilters, setSort];
}

export function PriceTable(props: PriceTableProps) {
  const { rows, locale } = props;
  const t = createT(locale);
  const [filters, sort, setFilters, setSort] = useTableState();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sorted = useMemo(() => sortRows(filterRows(rows, filters), sort), [rows, filters, sort]);
  const shown = sorted.slice(0, visible);
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
        platforms={props.platforms}
        onChange={onFilters}
      />
      <p className="text-small text-text-muted" aria-live="polite" data-testid="result-count">
        {t("table.resultCount", { count: sorted.length })}
      </p>
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
                  onSort={(key) => setSort(nextSort(sort, key))}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <Row key={row.id} row={row} props={props} />
            ))}
          </tbody>
        </table>
        {sorted.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-text-muted">
            <p>{t("table.empty")}</p>
            <button type="button" className="btn" onClick={() => onFilters(DEFAULT_FILTERS)}>
              {t("table.resetFilters")}
            </button>
          </div>
        )}
      </div>
      {sorted.length > visible && (
        <button
          type="button"
          className="btn self-center"
          onClick={() => setVisible(visible + PAGE_SIZE)}
        >
          {t("table.showMore", { count: sorted.length - visible })}
        </button>
      )}
    </div>
  );
}
