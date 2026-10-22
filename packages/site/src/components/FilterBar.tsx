/**
 * 价格总榜的筛选栏（STYLE §7.1）：搜索 + 厂商多选 + 模型多选 + 地区 + 平台 + 仅免费 + 上下文。
 * 手机端收进「筛选」抽屉（STYLE §11.1）。
 */
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Locale } from "../lib/locale";
import { createT } from "../lib/i18n";
import { formatTokens } from "../lib/shared-client";
import type { Option } from "../lib/views";
import {
  CONTEXT_OPTIONS,
  isDefaultFilters,
  pruneModels,
  type ModelOption,
  type RegionFilter,
  type TableFilters,
} from "../lib/table";

export type { Option };

export interface FilterBarProps {
  readonly locale: Locale;
  readonly filters: TableFilters;
  readonly vendors: readonly Option[];
  readonly models: readonly ModelOption[];
  readonly platforms: readonly Option[];
  readonly onChange: (next: TableFilters) => void;
}

const REGIONS: readonly RegionFilter[] = ["all", "intl", "cn"];

/** 按 group 分组，保持原有顺序；没有 group 的放在一组 null 里 */
function groupOptions(options: readonly Option[]): readonly [string | null, readonly Option[]][] {
  const groups = new Map<string | null, Option[]>();
  for (const option of options) {
    const key = option.group ?? null;
    const list = groups.get(key);
    if (list) list.push(option);
    else groups.set(key, [option]);
  }
  return [...groups.entries()];
}

/** 下拉列表一次最多渲染的条目数，避免几百个模型时卡顿；更多的用搜索定位 */
const MAX_VISIBLE_OPTIONS = 200;

interface PickerOption {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
}

interface MultiPickerProps {
  readonly label: string;
  readonly allLabel: string;
  readonly selectedLabel: (count: number) => string;
  readonly options: readonly PickerOption[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  readonly testId: string;
  /** 有值时在列表顶部显示搜索框 */
  readonly search?: {
    readonly placeholder: string;
    readonly empty: string;
    readonly clear: string;
  };
}

/** 点击下拉框外部时关闭 <details> */
function useCloseOnOutsideClick(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const el = ref.current;
      if (el?.open && event.target instanceof Node && !el.contains(event.target)) {
        el.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref]);
}

function MultiPicker(props: MultiPickerProps) {
  const { label, options, selected, onChange, search } = props;
  const ref = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  // 选项只在展开时渲染：上百个复选框会让首页 HTML 多出几十 KB
  const [open, setOpen] = useState(false);
  useCloseOnOutsideClick(ref);
  const toggle = (id: string): void => {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  };
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = options.filter((o) => {
    const haystack = `${o.name} ${o.id} ${o.hint ?? ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
  // 已选项始终排在最前，方便取消
  const ordered = [
    ...matched.filter((o) => selected.includes(o.id)),
    ...matched.filter((o) => !selected.includes(o.id)),
  ].slice(0, MAX_VISIBLE_OPTIONS);
  const summary = selected.length === 0 ? props.allLabel : props.selectedLabel(selected.length);
  return (
    <details
      ref={ref}
      className="group relative"
      data-testid={props.testId}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="input-base flex cursor-pointer list-none items-center gap-2 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-text-muted">{label}</span>
        <span className="font-medium">{summary}</span>
        <span aria-hidden="true" className="text-text-faint group-open:rotate-180">
          ▾
        </span>
      </summary>
      {open && (
        <div className="card absolute z-50 mt-1 flex w-72 flex-col shadow-lg">
          {search && (
            <div className="flex gap-2 border-b border-border p-2">
              <input
                type="search"
                className="input-base min-w-0 flex-1"
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                value={query}
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
              />
              {selected.length > 0 && (
                <button type="button" className="btn" onClick={() => onChange([])}>
                  {search.clear}
                </button>
              )}
            </div>
          )}
          <fieldset className="grid max-h-80 grid-cols-1 gap-0.5 overflow-auto p-2">
            <legend className="sr-only">{label}</legend>
            {ordered.length === 0 && search && (
              <p className="px-2 py-1.5 text-small text-text-muted">{search.empty}</p>
            )}
            {ordered.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-table hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={selected.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  value={o.id}
                />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                {o.hint && <span className="shrink-0 text-small text-text-faint">{o.hint}</span>}
              </label>
            ))}
          </fieldset>
        </div>
      )}
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
    // relative z-40：让下拉列表盖在表格的 sticky 表头（z-20/z-30）之上
    <div className="relative z-40 flex flex-col gap-3">
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
        <MultiPicker
          testId="vendor-filter"
          label={t("filter.vendor")}
          allLabel={t("filter.vendorAll")}
          selectedLabel={(count) => t("filter.vendorSelected", { count })}
          options={props.vendors}
          selected={filters.vendors}
          onChange={(vendors) =>
            onChange({ ...filters, vendors, models: pruneModels(filters.models, vendors) })
          }
        />
        <MultiPicker
          testId="model-filter"
          label={t("filter.model")}
          allLabel={t("filter.modelAll")}
          selectedLabel={(count) => t("filter.vendorSelected", { count })}
          options={props.models}
          selected={filters.models}
          onChange={(models) => onChange({ ...filters, models })}
          search={{
            placeholder: t("filter.modelSearch"),
            empty: t("filter.modelEmpty"),
            clear: t("filter.clear"),
          }}
        />
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
            {groupOptions(platforms).map(([group, options]) =>
              group === null ? (
                options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              ) : (
                <optgroup key={group} label={group}>
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
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
