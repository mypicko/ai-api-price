/**
 * 编程套餐表（DEV §3.15）：月费、额度说明、回本次数、额度价值。
 * 回本次数 = 月费 ÷ 计价模型按量付费一次的费用；单次用量（输入 / 输出 / 缓存命中率）可调，并同步到 URL。
 */
import { useEffect, useId, useState } from "react";
import { createT } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import {
  DEFAULT_ASSUMPTIONS,
  breakEven,
  creditsMultiple,
  parseAssumptions,
  serializeAssumptions,
  type PlanRow,
  type UsageAssumptions,
} from "../lib/plans";
import { formatPrice } from "../lib/shared-client";
import { DualPrice } from "./DualPrice";

export interface PlansTableProps {
  readonly rows: readonly PlanRow[];
  readonly locale: Locale;
  readonly fxNote: string;
}

/** 用量假设与 URL 同步：只改 in / out / cache，保留其他参数（kind 等） */
function useAssumptions(): [UsageAssumptions, (next: UsageAssumptions) => void] {
  const [state, setState] = useState<UsageAssumptions>(DEFAULT_ASSUMPTIONS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setState(parseAssumptions(window.location.search));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    ["in", "out", "cache"].forEach((key) => url.searchParams.delete(key));
    new URLSearchParams(serializeAssumptions(state)).forEach((v, k) => url.searchParams.set(k, v));
    window.history.replaceState(window.history.state, "", url);
  }, [state, ready]);
  return [state, setState];
}

function NumberField(props: {
  label: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-small text-text-muted">
      {props.label}
      <span className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className={`input-base w-36 text-right tabular ${props.suffix ? "pr-7" : ""}`}
          value={props.value}
          min={props.min}
          max={props.max}
          onChange={(e) => {
            const value = Number(e.target.value);
            if (Number.isFinite(value) && value >= props.min && value <= props.max)
              props.onChange(value);
          }}
        />
        {props.suffix && (
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-text-faint">
            {props.suffix}
          </span>
        )}
      </span>
    </label>
  );
}

function Assumptions(props: {
  value: UsageAssumptions;
  locale: Locale;
  onChange: (next: UsageAssumptions) => void;
}) {
  const t = createT(props.locale);
  const { value, onChange } = props;
  return (
    <fieldset className="flex flex-wrap items-end gap-3" data-testid="plan-assumptions">
      <legend className="mb-2 text-small font-semibold">{t("plans.assumptions")}</legend>
      <NumberField
        label={t("plans.inputTokens")}
        value={value.inputTokens}
        min={1}
        max={10_000_000}
        onChange={(inputTokens) => onChange({ ...value, inputTokens })}
      />
      <NumberField
        label={t("plans.outputTokens")}
        value={value.outputTokens}
        min={1}
        max={10_000_000}
        onChange={(outputTokens) => onChange({ ...value, outputTokens })}
      />
      <NumberField
        label={t("plans.cacheHitRate")}
        value={Math.round(value.cacheHitRate * 100)}
        suffix="%"
        min={0}
        max={100}
        onChange={(pct) => onChange({ ...value, cacheHitRate: pct / 100 })}
      />
      <button type="button" className="btn" onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>
        {t("plans.reset")}
      </button>
    </fieldset>
  );
}

function BreakEvenCell({ row, a, locale }: { row: PlanRow; a: UsageAssumptions; locale: Locale }) {
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

function Row({ row, a, props }: { row: PlanRow; a: UsageAssumptions; props: PlansTableProps }) {
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
      </td>
    </tr>
  );
}

export function PlansTable(props: PlansTableProps) {
  const t = createT(props.locale);
  const [assumptions, setAssumptions] = useAssumptions();
  const { rows } = props;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-small text-text-muted">{t("plans.lead")}</p>
      <Assumptions value={assumptions} locale={props.locale} onChange={setAssumptions} />
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
              <Row key={row.id} row={row} a={assumptions} props={props} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-micro text-text-faint">{t("plans.footnote")}</p>
    </div>
  );
}
