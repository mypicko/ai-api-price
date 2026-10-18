/**
 * 成本计算器（DEV §3.11、STYLE §7.3）。计算全部在浏览器本地完成。
 * 结果同时渲染 USD/CNY 两份（按所选币种显示）；换算是线性的，所以两种币种的排名一致。
 */
import { useId, useMemo, useState } from "react";
import type { Locale } from "../lib/locale";
import {
  DEFAULT_INPUTS,
  computeUsage,
  parsePercent,
  parseTokenInput,
  rankOfferings,
  type CalcInputs,
  type CalcMode,
  type CalcOffering,
} from "../lib/calculator";
import { createT, formatTokenVolume, type MessageKey } from "../lib/i18n";
import { convertCurrency } from "../lib/shared-client";
import { modelPath, pageHref } from "../lib/url";
import { DualPrice } from "./DualPrice";
import type { Option } from "../lib/views";

export interface CalculatorProps {
  readonly offerings: readonly CalcOffering[];
  readonly vendors: readonly Option[];
  readonly locale: Locale;
  readonly base: string;
  readonly usdCny: number;
  readonly fxNote: string;
}

type TextField =
  | "inputTokens"
  | "outputTokens"
  | "requestsPerDay"
  | "monthlyInput"
  | "monthlyOutput"
  | "cacheHitRate"
  | "daysPerMonth";

const DEFAULT_TEXT: Readonly<Record<TextField, string>> = {
  inputTokens: "2,000",
  outputTokens: "500",
  requestsPerDay: "1,000",
  monthlyInput: "60m",
  monthlyOutput: "15m",
  cacheHitRate: "0",
  daysPerMonth: "30",
};

const LABELS: Readonly<Record<TextField, MessageKey>> = {
  inputTokens: "calc.inputTokens",
  outputTokens: "calc.outputTokens",
  requestsPerDay: "calc.requestsPerDay",
  monthlyInput: "calc.monthlyInput",
  monthlyOutput: "calc.monthlyOutput",
  cacheHitRate: "calc.cacheHitRate",
  daysPerMonth: "calc.daysPerMonth",
};

function parseField(field: TextField, text: string): number | null {
  if (field === "cacheHitRate") return parsePercent(text);
  if (field === "daysPerMonth") {
    const days = parseTokenInput(text);
    return days !== null && days >= 1 && days <= 31 ? days : null;
  }
  return parseTokenInput(text);
}

function toInputs(mode: CalcMode, text: Readonly<Record<TextField, string>>): CalcInputs {
  const value = (field: TextField): number =>
    parseField(field, text[field]) ?? DEFAULT_INPUTS[field];
  return {
    mode,
    inputTokens: value("inputTokens"),
    outputTokens: value("outputTokens"),
    requestsPerDay: value("requestsPerDay"),
    monthlyInput: value("monthlyInput"),
    monthlyOutput: value("monthlyOutput"),
    cacheHitRate: value("cacheHitRate"),
    daysPerMonth: value("daysPerMonth"),
  };
}

function NumberField({
  field,
  text,
  locale,
  onChange,
}: {
  field: TextField;
  text: string;
  locale: Locale;
  onChange: (v: string) => void;
}) {
  const t = createT(locale);
  const id = useId();
  const invalid = parseField(field, text) === null;
  const isPercent = field === "cacheHitRate";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-medium text-text-muted">
        {t(LABELS[field])}
      </label>
      <div className="relative">
        <input
          id={id}
          name={field}
          inputMode={isPercent || field === "daysPerMonth" ? "decimal" : "text"}
          autoComplete="off"
          className={`input-base w-full text-right tabular ${isPercent ? "pr-8" : ""} ${invalid ? "border-up" : ""}`}
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {isPercent && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-small text-text-muted">
            %
          </span>
        )}
      </div>
      {invalid && (
        <span id={`${id}-error`} className="text-micro text-up">
          {t("calc.invalid")}
        </span>
      )}
    </div>
  );
}

export function Calculator(props: CalculatorProps) {
  const { locale } = props;
  const t = createT(locale);
  const [mode, setMode] = useState<CalcMode>("perRequest");
  const [text, setText] = useState<Readonly<Record<TextField, string>>>(DEFAULT_TEXT);
  const [vendors, setVendors] = useState<readonly string[]>([]);
  const inputs = toInputs(mode, text);
  const usage = computeUsage(inputs);
  const results = useMemo(
    () => rankOfferings(props.offerings, usage, { currency: "USD", usdCny: props.usdCny, vendors }),
    [
      props.offerings,
      props.usdCny,
      usage.monthlyInput,
      usage.monthlyOutput,
      usage.cachedInput,
      usage.perRequestInput,
      vendors,
    ],
  );
  const fields: readonly TextField[] =
    mode === "perRequest"
      ? ["inputTokens", "outputTokens", "requestsPerDay", "cacheHitRate", "daysPerMonth"]
      : ["monthlyInput", "monthlyOutput", "cacheHitRate"];
  const toggleVendor = (id: string): void =>
    setVendors(vendors.includes(id) ? vendors.filter((v) => v !== id) : [...vendors, id]);

  return (
    <div className="grid gap-8 lg:grid-cols-[320px_1fr]" data-testid="calculator">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => e.preventDefault()}
        aria-label={t("calc.title")}
      >
        <div role="group" aria-label={t("calc.mode")} className="segmented self-start">
          {(["perRequest", "monthly"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(m === "perRequest" ? "calc.mode.perRequest" : "calc.mode.monthly")}
            </button>
          ))}
        </div>
        {fields.map((field) => (
          <NumberField
            key={field}
            field={field}
            text={text[field]}
            locale={locale}
            onChange={(v) => setText({ ...text, [field]: v })}
          />
        ))}
        <p className="text-micro text-text-muted">{t("calc.hint.tokens")}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-text-muted">
            {t("calc.vendors")}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {props.vendors.map((v) => (
              <label
                key={v.id}
                className={`cursor-pointer rounded-sm border px-2 py-1 text-small has-focus-visible:outline-2 has-focus-visible:outline-focus ${
                  vendors.includes(v.id)
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border text-text-muted hover:bg-surface-hover"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={vendors.includes(v.id)}
                  onChange={() => toggleVendor(v.id)}
                />
                {v.name}
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="btn self-start"
          onClick={() => {
            setText(DEFAULT_TEXT);
            setVendors([]);
            setMode("perRequest");
          }}
        >
          {t("calc.reset")}
        </button>
      </form>

      <section aria-labelledby="calc-results" className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="calc-results" className="text-h2">
            {t("calc.results", { count: results.length })}
          </h2>
          <p className="text-small text-text-muted tabular" data-testid="calc-usage">
            {t("calc.usage", {
              input: formatTokenVolume(usage.monthlyInput, locale),
              output: formatTokenVolume(usage.monthlyOutput, locale),
            })}
          </p>
        </div>
        {results.length === 0 ? (
          <p className="rounded-lg border border-border p-8 text-center text-text-muted">
            {t("calc.noResults")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-table" data-testid="calc-results">
              <thead className="bg-surface text-small text-text-muted">
                <tr>
                  <th scope="col" className="w-12 px-3 py-2 text-right font-semibold">
                    {t("calc.rank")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("table.column.model")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    {t("table.column.platform")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    {t("calc.monthlyCost")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const usd = r.cost;
                  const cny = convertCurrency(
                    r.costOriginal,
                    r.offering.currency,
                    "CNY",
                    props.usdCny,
                  );
                  return (
                    <tr key={r.offering.id} className="h-11 border-t border-border">
                      <td className="px-3 text-right text-text-muted tabular">{i + 1}</td>
                      <th scope="row" className="px-3 text-left font-normal">
                        <a
                          className="font-medium hover:text-accent hover:underline"
                          href={pageHref(props.base, locale, modelPath(r.offering.modelSlug))}
                        >
                          {r.offering.displayName}
                        </a>
                        <span className="ml-2 text-small text-text-muted">
                          {r.offering.vendorName}
                        </span>
                        {r.tierIndex !== null && (
                          <span className="ml-2 rounded-sm border border-border px-1 text-micro text-text-muted">
                            {t("calc.tier", { n: r.tierIndex + 1 })}
                          </span>
                        )}
                      </th>
                      <td className="px-3 whitespace-nowrap text-text-muted">
                        {r.offering.platformName}
                      </td>
                      <td className="px-3 text-right font-semibold whitespace-nowrap tabular">
                        <DualPrice
                          currency={r.offering.currency}
                          usd={usd}
                          cny={cny}
                          locale={locale}
                          fxNote={props.fxNote}
                          freeBadge={false}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-small text-text-muted">{t("calc.formula")}</p>
      </section>
    </div>
  );
}
