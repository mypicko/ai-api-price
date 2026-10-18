/**
 * 视频/图像价格表（DEV §3.10）。视频 / 图像两个标签页，各自的单位：视频每秒、图像每张。
 * 首屏在构建时渲染成 HTML（视频页），水合后启用标签切换、搜索、排序和 ?kind= 同步。
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { MediaKind } from "@aipb/shared";
import type { Locale } from "../lib/locale";
import { createT, formatDateTime, formatRelative, type MessageKey } from "../lib/i18n";
import {
  DEFAULT_MEDIA_SORT,
  MEDIA_KINDS,
  countByKind,
  filterMediaRows,
  mediaAriaSort,
  nextMediaSort,
  parseMediaKind,
  sortMediaRows,
  type MediaRow,
  type MediaSort,
  type MediaSortKey,
} from "../lib/media";
import { PctBadge, StatusBadge } from "./ChangeBadge";
import { DualPrice } from "./DualPrice";

export interface MediaTableProps {
  readonly rows: readonly MediaRow[];
  readonly locale: Locale;
  readonly nowIso: string;
  readonly fxNote: string;
}

interface Column {
  readonly key: MediaSortKey | null;
  readonly label: (kind: MediaKind) => MessageKey;
  readonly numeric: boolean;
  /** 单位：price = 随标签页；image = 固定每张 */
  readonly unit?: "price" | "image";
  readonly hideSm?: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: "model", label: () => "media.column.model", numeric: false },
  { key: "vendor", label: () => "media.column.vendor", numeric: false, hideSm: true },
  { key: "price", label: (k) => `media.column.price.${k}`, numeric: true, unit: "price" },
  { key: null, label: (k) => `media.column.tiers.${k}`, numeric: false, hideSm: true },
  { key: "input", label: () => "media.column.input", numeric: true, unit: "image", hideSm: true },
  { key: null, label: () => "media.column.change7d", numeric: true, hideSm: true },
  { key: "updated", label: () => "media.column.updated", numeric: true },
];

const STICKY = "sticky left-0 z-10 bg-bg group-hover:bg-surface-hover";
const MAX_TIERS_SHOWN = 4;

function unitKey(kind: MediaKind, unit: Column["unit"]): MessageKey {
  return unit === "image" || kind === "image" ? "media.unit.image" : "media.unit.second";
}

function Unit({ locale, kind, unit }: { locale: Locale; kind: MediaKind; unit: Column["unit"] }) {
  const t = createT(locale);
  const key = unitKey(kind, unit);
  return (
    <span className="ml-1 font-normal text-text-faint">
      <span className="cur-USD">{t(key, { symbol: "$" })}</span>
      <span className="cur-CNY">{t(key, { symbol: "¥" })}</span>
    </span>
  );
}

function HeaderCell(props: {
  column: Column;
  kind: MediaKind;
  sort: MediaSort;
  locale: Locale;
  onSort: (key: MediaSortKey) => void;
}) {
  const { column, kind, sort, locale, onSort } = props;
  const t = createT(locale);
  const label = t(column.label(kind));
  const state = column.key ? mediaAriaSort(sort, column.key) : "none";
  const arrow = state === "ascending" ? "▲" : state === "descending" ? "▼" : "";
  const align = column.numeric ? "text-right" : "text-left";
  const content = (
    <>
      {label}
      {column.unit && <Unit locale={locale} kind={kind} unit={column.unit} />}
    </>
  );
  return (
    <th
      scope="col"
      aria-sort={column.key ? state : undefined}
      className={`sticky top-0 z-20 border-b border-border bg-surface px-3 py-2 text-small font-semibold whitespace-nowrap text-text-muted ${align} ${column.hideSm ? "max-sm:hidden" : ""} ${column.key === "model" ? "left-0 z-30" : ""}`}
    >
      {column.key === null ? (
        content
      ) : (
        <button
          type="button"
          onClick={() => column.key && onSort(column.key)}
          className={`inline-flex items-center gap-1 rounded-sm hover:text-text ${column.numeric ? "flex-row-reverse" : ""} ${state === "none" ? "" : "text-text"}`}
          title={t("table.sortBy", { column: label })}
        >
          <span>{content}</span>
          <span aria-hidden="true" className="inline-block w-2.5 text-[10px] text-accent">
            {arrow}
          </span>
        </button>
      )}
    </th>
  );
}

function Tiers({ row, props }: { row: MediaRow; props: MediaTableProps }) {
  const t = createT(props.locale);
  if (row.tiers.length === 0) return <span className="text-text-faint">—</span>;
  const shown = row.tiers.slice(0, MAX_TIERS_SHOWN);
  const rest = row.tiers.length - shown.length;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-small" data-testid="media-tiers">
      {shown.map((tier) => (
        <li key={tier.label} className="whitespace-nowrap">
          <span className="text-text-muted">{tier.label}</span>{" "}
          <span className="tabular">
            <DualPrice
              currency={row.currency}
              usd={tier.usd}
              cny={tier.cny}
              locale={props.locale}
              fxNote={props.fxNote}
              freeBadge={false}
            />
          </span>
        </li>
      ))}
      {rest > 0 && (
        <li
          className="text-text-faint"
          title={row.tiers
            .slice(MAX_TIERS_SHOWN)
            .map((x) => x.label)
            .join(", ")}
        >
          {t("media.tiersMore", { count: rest })}
        </li>
      )}
    </ul>
  );
}

function PriceCell({ row, index, props }: { row: MediaRow; index: 0 | 1; props: MediaTableProps }) {
  return (
    <DualPrice
      currency={row.currency}
      usd={row.usd[index]}
      cny={row.cny[index]}
      locale={props.locale}
      fxNote={props.fxNote}
    />
  );
}

function Row({ row, props }: { row: MediaRow; props: MediaTableProps }) {
  const t = createT(props.locale);
  const stale = t("table.stale", { date: formatDateTime(row.fetchedAt, props.locale) });
  return (
    <tr
      className="group h-13 border-b border-border text-table hover:bg-surface-hover sm:h-11"
      data-id={row.id}
    >
      <th
        scope="row"
        className={`${STICKY} max-w-[160px] px-3 py-1.5 text-left font-normal sm:max-w-none`}
      >
        <div className="flex items-center gap-1.5">
          <a
            href={row.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium hover:text-accent hover:underline"
            title={t("model.sourceLink")}
          >
            {row.displayName}
          </a>
          {row.status === "missing" && <StatusBadge kind="missing" locale={props.locale} />}
        </div>
        <div className="hidden truncate font-mono text-micro text-text-faint sm:block">
          {row.model}
        </div>
        <div className="truncate text-micro text-text-muted sm:hidden">{row.vendorName}</div>
      </th>
      <td className="px-3 whitespace-nowrap max-sm:hidden">{row.vendorName}</td>
      <td
        className="px-3 text-right font-medium whitespace-nowrap tabular"
        title={t("media.defaultTier")}
      >
        <PriceCell row={row} index={0} props={props} />
      </td>
      <td className="px-3 py-1.5 max-sm:hidden">
        <Tiers row={row} props={props} />
      </td>
      <td className="px-3 text-right whitespace-nowrap tabular max-sm:hidden">
        <PriceCell row={row} index={1} props={props} />
      </td>
      <td className="px-3 text-right whitespace-nowrap max-sm:hidden">
        <PctBadge pct={row.change7d} locale={props.locale} />
      </td>
      <td className="px-3 text-right text-small whitespace-nowrap text-text-muted tabular">
        {row.stale && (
          <span className="mr-1 text-warn" role="img" aria-label={stale} title={stale}>
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

function useKind(): [MediaKind, (kind: MediaKind) => void] {
  const [kind, setKind] = useState<MediaKind>("video");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setKind(parseMediaKind(window.location.search));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (kind === "video") url.searchParams.delete("kind");
    else url.searchParams.set("kind", kind);
    window.history.replaceState(window.history.state, "", url);
  }, [kind, ready]);
  return [kind, setKind];
}

function Tabs(props: {
  kind: MediaKind;
  counts: Readonly<Record<MediaKind, number>>;
  locale: Locale;
  onChange: (kind: MediaKind) => void;
}) {
  const t = createT(props.locale);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = props.kind === "video" ? "image" : "video";
    props.onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("media.tabs")}
      className="flex gap-1 border-b border-border"
      onKeyDown={onKeyDown}
    >
      {MEDIA_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          id={`media-tab-${k}`}
          data-kind={k}
          aria-selected={props.kind === k}
          aria-controls="media-panel"
          tabIndex={props.kind === k ? 0 : -1}
          onClick={() => props.onChange(k)}
          className="-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 border-transparent px-3 text-table text-text-muted hover:text-text aria-selected:border-accent aria-selected:font-semibold aria-selected:text-text"
        >
          {t(`media.tab.${k}`)}
          <span className="rounded-sm bg-surface px-1.5 text-micro tabular text-text-muted">
            {props.counts[k]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function MediaTable(props: MediaTableProps) {
  const { rows, locale } = props;
  const t = createT(locale);
  const [kind, setKind] = useKind();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<MediaSort>(DEFAULT_MEDIA_SORT);
  const counts = useMemo(() => countByKind(rows), [rows]);
  const shown = useMemo(
    () => sortMediaRows(filterMediaRows(rows, { kind, query }), sort),
    [rows, kind, query, sort],
  );
  return (
    <div className="flex flex-col gap-3">
      <Tabs kind={kind} counts={counts} locale={locale} onChange={setKind} />
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input-base w-full sm:w-72"
          placeholder={t("media.search")}
          aria-label={t("media.search")}
          value={query}
          maxLength={100}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="text-small text-text-muted" aria-live="polite" data-testid="media-count">
          {t("media.resultCount", { count: shown.length })}
        </p>
      </div>
      <div
        id="media-panel"
        role="tabpanel"
        aria-labelledby={`media-tab-${kind}`}
        className="overflow-x-auto rounded-lg border border-border sm:max-h-[78vh] sm:overflow-y-auto"
      >
        <table className="w-full border-collapse" data-testid="media-table" data-kind={kind}>
          <caption className="sr-only">{t(`media.caption.${kind}`)}</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <HeaderCell
                  key={c.label(kind)}
                  column={c}
                  kind={kind}
                  sort={sort}
                  locale={locale}
                  onSort={(key) => setSort(nextMediaSort(sort, key))}
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
        {shown.length === 0 && (
          <p className="px-4 py-12 text-center text-text-muted">{t("media.empty")}</p>
        )}
      </div>
    </div>
  );
}
