/**
 * 编程套餐表（DEV §3.15）：月费、额度说明、回本次数、额度价值。
 * 回本次数 = 月费 ÷ 计价模型按量付费一次的费用，单次用量固定为 DEFAULT_ASSUMPTIONS（编程 Agent 的典型用量）。
 * 可按关键字、地区、是否公开额度筛选，按月费 / 回本次数 / 额度价值排序；筛选同步到 URL。
 */
import { useEffect, useId, useMemo, useState } from "react";
import { createT } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PLAN_FILTERS,
  breakEven,
  creditsMultiple,
  filterPlans,
  parsePlanFilters,
  serializePlanFilters,
  sortPlans,
  type PlanFilters,
  type PlanRegion,
  type PlanRow,
  type PlanSort,
} from "../lib/plans";
import { correctionUrl } from "../lib/feedback";
import { formatPrice } from "../lib/shared-client";
import { DualPrice } from "./DualPrice";

export interface PlansTableProps {
  readonly rows: readonly PlanRow[];
  readonly locale: Locale;
  readonly fxNote: string;
  /** GitHub 仓库（owner/name），用于纠错链接 */
  readonly repo: string;
  /** 编程套餐标签页的绝对地址，写进纠错表单 */
  readonly pageUrl: string;
}

/**
 * 本表在 URL 里用到的参数；同步时只改这些，保留其他参数（kind 等）。
 * in / out / cache 是早期版本的单次用量参数，已移除，这里顺手清掉旧链接里的残留。
 */
const OWN_PARAMS = ["q", "region", "quota", "psort", "in", "out", "cache"] as const;

function usePlanFilters(): [PlanFilters, (next: PlanFilters) => void] {
  const [filters, setFilters] = useState<PlanFilters>(DEFAULT_PLAN_FILTERS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setFilters(parsePlanFilters(window.location.search));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    OWN_PARAMS.forEach((key) => url.searchParams.delete(key));
    new URLSearchParams(serializePlanFilters(filters)).forEach((v, k) =>
      url.searchParams.set(k, v),
    );
    window.history.replaceState(window.history.state, "", url);
  }, [filters, ready]);
  return [filters, setFilters];
}

const REGIONS: readonly PlanRegion[] = ["all", "intl", "cn"];
const SORTS: readonly PlanSort[] = ["price", "breakEven", "credits"];

function PlanFilterBar(props: {
  value: PlanFilters;
  count: number;
  locale: Locale;
  onChange: (next: PlanFilters) => void;
}) {
  const t = createT(props.locale);
  const { value, onChange } = props;
  const searchId = useId();
  const sortId = useId();
  return (
    <div className="flex flex-col gap-3" data-testid="plan-filters">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={searchId} className="sr-only">
          {t("plans.filter.search")}
        </label>
        <input
          id={searchId}
          type="search"
          className="input-base min-w-0 flex-1 sm:max-w-sm"
          placeholder={t("plans.filter.searchPlaceholder")}
          value={value.q}
          maxLength={100}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
        />
        <div role="group" aria-label={t("filter.region")} className="segmented">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={value.region === r}
              onClick={() => onChange({ ...value, region: r })}
            >
              {t(`filter.region.${r}`)}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-table">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={value.publishedOnly}
            onChange={(e) => onChange({ ...value, publishedOnly: e.target.checked })}
          />
          {t("plans.filter.publishedOnly")}
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor={sortId} className="text-small text-text-muted">
            {t("plans.filter.sort")}
          </label>
          <select
            id={sortId}
            className="input-base"
            value={value.sort}
            onChange={(e) => onChange({ ...value, sort: e.target.value as PlanSort })}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`plans.sort.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-small text-text-muted" aria-live="polite" data-testid="plan-count">
        {t("plans.resultCount", { count: props.count })}
      </p>
    </div>
  );
}

function BreakEvenCell({
  row,
  a,
  locale,
}: {
  row: PlanRow;
  a: typeof DEFAULT_ASSUMPTIONS;
  locale: Locale;
}) {
  const t = createT(locale);
  const result = breakEven(row, a);
  if (!result || !row.model) {
    return (
      <span className="text-text-faint" title={t("plans.noModel")}>
        —
      </span>
    );
  }
  const title = t("plans.breakEvenTitle", {
    model: row.model.displayName,
    cost: formatPrice(result.perRequestUsd, "USD", { locale }),
  });
  return (
    <span title={title} className="flex flex-col items-end">
      <span className="font-medium tabular">
        {t("plans.perMonth", { count: result.perMonth.toLocaleString("en-US") })}
      </span>
      <span className="text-micro text-text-muted tabular">
        {t("plans.perDay", { count: result.perDay.toLocaleString("en-US") })} ·{" "}
        {row.model.displayName}
      </span>
    </span>
  );
}

function Row({
  row,
  a,
  props,
}: {
  row: PlanRow;
  a: typeof DEFAULT_ASSUMPTIONS;
  props: PlansTableProps;
}) {
  const t = createT(props.locale);
  const multiple = creditsMultiple(row);
  return (
    <tr className="border-b border-border text-table align-top" data-id={row.id}>
      <th scope="row" className="px-3 py-2.5 text-left font-normal">
        <div className="font-medium">
          {row.providerName} · {row.name}
        </div>
        <div className="mt-0.5 max-w-xs text-micro text-text-muted">{row.tools}</div>
      </th>
      <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
        <DualPrice
          currency={row.currency}
          usd={row.monthly.usd}
          cny={row.monthly.cny}
          locale={props.locale}
          fxNote={props.fxNote}
          freeBadge={false}
        />
        {row.annualMonthly && (
          <div className="text-micro text-text-muted">
            {t("plans.annual")}{" "}
            <DualPrice
              currency={row.currency}
              usd={row.annualMonthly.usd}
              cny={row.annualMonthly.cny}
              locale={props.locale}
              fxNote={props.fxNote}
              freeBadge={false}
            />
          </div>
        )}
      </td>
      <td className="max-w-sm px-3 py-2.5 text-small" data-quota-kind={row.quotaKind}>
        {row.quota}
        {row.notes && <div className="text-micro text-text-muted">{row.notes}</div>}
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap" data-testid="break-even">
        <BreakEvenCell row={row} a={a} locale={props.locale} />
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
        {multiple === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span title={t("plans.creditsTitle", { credits: `$${row.creditsUsd}` })}>
            ×{multiple.toFixed(2)}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-small whitespace-nowrap">
        <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="link">
          {t("plans.source")}
        </a>
        <div className="text-micro text-text-muted tabular">
          {t("plans.verifiedAt", { date: row.verifiedAt })}
        </div>
        <a
          href={correctionUrl(props.repo, {
            item: `${row.providerName} · ${row.name}`,
            current: `${formatPrice(row.currency === "USD" ? row.monthly.usd : row.monthly.cny, row.currency, { locale: props.locale })}${t("plans.perMonthUnit")}`,
            evidence: row.sourceUrl,
            page: props.pageUrl,
          })}
          target="_blank"
          rel="noopener noreferrer"
          className="link text-micro text-text-muted"
          title={t("feedback.reportTitle")}
          data-testid="report-plan"
        >
          {t("feedback.report")}
        </a>
      </td>
    </tr>
  );
}

export function PlansTable(props: PlansTableProps) {
  const t = createT(props.locale);
  const [filters, setFilters] = usePlanFilters();
  const rows = useMemo(
    () => sortPlans(filterPlans(props.rows, filters), filters.sort, DEFAULT_ASSUMPTIONS),
    [props.rows, filters],
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-small text-text-muted">{t("plans.lead")}</p>
      <PlanFilterBar
        value={filters}
        count={rows.length}
        locale={props.locale}
        onChange={setFilters}
      />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse" data-testid="plans-table">
          <caption className="sr-only">{t("plans.caption")}</caption>
          <thead className="bg-surface text-small text-text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("plans.column.plan")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("plans.column.monthly")}
              </th>
              <th scope="col" className="px-3 py-2 text-left font-semibold">
                {t("plans.column.quota")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("plans.column.breakEven")}
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right font-semibold"
                title={t("plans.column.creditsHint")}
              >
                {t("plans.column.credits")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">
                {t("plans.column.source")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.id} row={row} a={DEFAULT_ASSUMPTIONS} props={props} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-text-muted">
            <p>{t("plans.empty")}</p>
            <button type="button" className="btn" onClick={() => setFilters(DEFAULT_PLAN_FILTERS)}>
              {t("table.resetFilters")}
            </button>
          </div>
        )}
      </div>
      <p className="text-micro text-text-faint">{t("plans.footnote")}</p>
    </div>
  );
}
