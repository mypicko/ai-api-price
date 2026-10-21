/**
 * 变动日志（DEV §3.10）：按日期分组，可按类型、厂商筛选（ChangeFilter）。
 * 首屏在构建时渲染全部记录，水合后启用筛选。
 */
import type { ChangeType } from "@aipb/shared";
import { useId, useMemo, useState } from "react";
import type { Locale } from "../lib/locale";
import { createT, formatDate, shanghaiDate } from "../lib/i18n";
import { EventItem, type EventView } from "./EventItem";
import type { Option } from "../lib/views";

export interface ChangeLogProps {
  readonly events: readonly EventView[];
  readonly vendors: readonly Option[];
  readonly locale: Locale;
  readonly base: string;
}

/** 首次运行时可能有几百条「新模型」事件，先显示 100 条 */
const PAGE_SIZE = 100;

const TYPES: readonly ChangeType[] = [
  "price_down",
  "price_up",
  "new_model",
  "removed",
  "restored",
  "context_change",
];

export function ChangeLog(props: ChangeLogProps) {
  const { locale } = props;
  const t = createT(locale);
  const [type, setType] = useState<ChangeType | "all">("all");
  const [vendor, setVendor] = useState("all");
  const typeId = useId();
  const vendorId = useId();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const filtered = useMemo(
    () =>
      props.events.filter(
        (e) => (type === "all" || e.type === type) && (vendor === "all" || e.vendor === vendor),
      ),
    [props.events, type, vendor],
  );
  const groups = useMemo(
    () => [...Map.groupBy(filtered.slice(0, visible), (e) => shanghaiDate(e.detectedAt)).entries()],
    [filtered, visible],
  );
  const count = filtered.length;

  return (
    <div className="flex flex-col gap-6" data-testid="change-log">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={typeId} className="text-small text-text-muted">
            {t("changes.filter.type")}
          </label>
          <select
            id={typeId}
            className="input-base"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ChangeType | "all");
              setVisible(PAGE_SIZE);
            }}
          >
            <option value="all">{t("changes.filter.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`change.type.${ty}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={vendorId} className="text-small text-text-muted">
            {t("changes.filter.vendor")}
          </label>
          <select
            id={vendorId}
            className="input-base"
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value);
              setVisible(PAGE_SIZE);
            }}
          >
            <option value="all">{t("changes.filter.allVendors")}</option>
            {props.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <span className="text-small text-text-muted" aria-live="polite">
          {t("changes.count", { count })}
        </span>
      </div>
      {groups.length === 0 && (
        <p className="rounded-lg border border-border p-8 text-center text-text-muted">
          {t("changes.empty")}
        </p>
      )}
      {groups.map(([date, items]) => (
        <section
          key={date}
          aria-labelledby={`d-${date}`}
          className="grid gap-2 md:grid-cols-[160px_1fr]"
        >
          <h2 id={`d-${date}`} className="text-h3 tabular md:pt-3">
            <time dateTime={date}>{formatDate(date, locale)}</time>
          </h2>
          <ol className="divide-y divide-border border-t border-border md:border-t-0">
            {items.map((e) => (
              <li key={e.id}>
                <EventItem event={e} locale={locale} base={props.base} />
              </li>
            ))}
          </ol>
        </section>
      ))}
      {count > visible && (
        <button
          type="button"
          className="btn self-center"
          onClick={() => setVisible(visible + PAGE_SIZE)}
        >
          {t("table.showMore", { count: count - visible })}
        </button>
      )}
    </div>
  );
}
