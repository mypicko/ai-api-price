/**
 * 价格总榜的筛选栏（STYLE §7.1）：搜索 + 厂商多选 + 地区 + 平台 + 仅免费 + 上下文。
 * 手机端收进「筛选」抽屉（STYLE §11.1）。
 */
import { useId, useState } from "react";
import type { Locale } from "../lib/locale";
import { createT } from "../lib/i18n";
import { formatTokens } from "../lib/shared-client";
import type { Option } from "../lib/views";
import {
  CONTEXT_OPTIONS,
  isDefaultFilters,
  type RegionFilter,
  type TableFilters,
} from "../lib/table";

export type { Option };

export interface FilterBarProps {
  readonly locale: Locale;
  readonly filters: TableFilters;
  readonly vendors: readonly Option[];
  readonly platforms: readonly Option[];
  readonly onChange: (next: TableFilters) => void;
}

const REGIONS: readonly RegionFilter[] = ["all", "intl", "cn"];

function VendorPicker({ locale, filters, vendors, onChange }: Omit<FilterBarProps, "platforms">) {
  const t = createT(locale);
  const selected = filters.vendors;
  const toggle = (id: string): void => {
    const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
    onChange({ ...filters, vendors: next });
  };
  const summary =
    selected.length === 0
      ? t("filter.vendorAll")
      : t("filter.vendorSelected", { count: selected.length });
  return (
    <details className="group relative" data-testid="vendor-filter">
      <summary className="input-base flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-text-muted">{t("filter.vendor")}</span>
        <span className="font-medium">{summary}</span>
        <span aria-hidden="true" className="text-text-faint group-open:rotate-180">
          ▾
        </span>
      </summary>
      <fieldset className="card absolute z-30 mt-1 grid max-h-80 w-64 grid-cols-1 gap-0.5 overflow-auto p-2">
        <legend className="sr-only">{t("filter.vendor")}</legend>
        {vendors.map((v) => (
          <label
            key={v.id}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-table hover:bg-surface-hover"
          >
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={selected.includes(v.id)}
              onChange={() => toggle(v.id)}
              value={v.id}
            />
            {v.name}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

export function FilterBar(props: FilterBarProps) {
  const { locale, filters, platforms, onChange } = props;
  const t = createT(locale);
  const [open, setOpen] = useState(false);
  const searchId = useId();
  const platformId = useId();
  const contextId = useId();
  const active = !isDefaultFilters(filters);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label htmlFor={searchId} className="sr-only">
          {t("filter.search")}
        </label>
        <input
          id={searchId}
          type="search"
          className="input-base min-w-0 flex-1 sm:max-w-sm"
          placeholder={t("filter.searchPlaceholder")}
          value={filters.q}
          maxLength={100}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
        />
        <button
          type="button"
          className="btn sm:hidden"
          aria-expanded={open}
          aria-controls={`${searchId}-panel`}
          onClick={() => setOpen(!open)}
        >
          {t("filter.toggle")}
          {active && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
        </button>
      </div>
      <div
        id={`${searchId}-panel`}
        className={`${open ? "flex" : "hidden"} flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center`}
      >
        <VendorPicker {...props} />
        <div role="group" aria-label={t("filter.region")} className="segmented">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={filters.region === r}
              onClick={() => onChange({ ...filters, region: r })}
            >
              {t(`filter.region.${r}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={platformId} className="text-small text-text-muted">
            {t("filter.platform")}
          </label>
          <select
            id={platformId}
            className="input-base"
            value={filters.platform}
            onChange={(e) => onChange({ ...filters, platform: e.target.value })}
          >
            <option value="all">{t("filter.platform.all")}</option>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={contextId} className="text-small text-text-muted">
            {t("filter.minContext")}
          </label>
          <select
            id={contextId}
            className="input-base tabular"
            value={filters.minContext ?? ""}
            onChange={(e) =>
              onChange({
                ...filters,
                minContext: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">{t("filter.minContext.any")}</option>
            {CONTEXT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {formatTokens(n)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-table">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={filters.freeOnly}
            onChange={(e) => onChange({ ...filters, freeOnly: e.target.checked })}
          />
          {t("filter.freeOnly")}
        </label>
        <button type="button" className="btn sm:hidden" onClick={() => setOpen(false)}>
          {t("filter.close")}
        </button>
      </div>
    </div>
  );
}
