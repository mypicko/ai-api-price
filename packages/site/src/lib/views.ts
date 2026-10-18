/**
 * 页面传给交互组件的 props（必须可序列化，STYLE §7.2）。构建时运行。
 */
import type { ChangeEvent, ChangeField, MediaUnit } from "@aipb/shared";
import type { CalcOffering } from "./calculator";
import type { ChartOffering } from "./chart";
import { t } from "./i18n";
import { formatMediaPrice, formatPct } from "./shared-client";
import type { Locale } from "./locale";
import { platformName, vendorName, type ModelInfo, type SiteModel } from "./site-model";

export interface Option {
  readonly id: string;
  readonly name: string;
}

export interface EventView {
  readonly id: string;
  readonly type: ChangeEvent["type"];
  readonly displayName: string;
  readonly modelSlug: string;
  readonly vendor: string;
  readonly vendorName: string;
  readonly platformName: string;
  readonly currency: ChangeEvent["currency"];
  readonly fields: ChangeEvent["fields"];
  readonly detectedAt: string;
  readonly confirmedFromQuarantine: boolean;
  readonly current: { readonly input: number | null; readonly output: number | null } | null;
}

/** 「按 1 USD = 7.10 CNY 换算（2026-10-18）」 */
export function fxNote(model: SiteModel, locale: Locale): string {
  return t(locale, "price.converted", { rate: model.usdCny.toFixed(2), date: model.fxDate });
}

/** 有报价的厂商（按名称排序） */
export function vendorOptions(
  model: SiteModel,
  locale: Locale,
  ids?: readonly string[],
): readonly Option[] {
  const used = new Set(ids ?? model.offerings.map((o) => o.vendor));
  return [...used]
    .map((id) => ({ id, name: vendorName(model, id, locale) }))
    .toSorted((a, b) => a.name.localeCompare(b.name, locale === "zh" ? "zh-CN" : "en"));
}

/** 平台按配置文件的顺序 */
export function platformOptions(model: SiteModel, locale: Locale): readonly Option[] {
  const used = new Set(model.offerings.map((o) => o.platform));
  const configured = model.data.providers.platforms.map((p) => p.id).filter((id) => used.has(id));
  const extra = [...used].filter((id) => !configured.includes(id)).toSorted();
  return [...configured, ...extra].map((id) => ({ id, name: platformName(model, id, locale) }));
}

export function toEventView(model: SiteModel, event: ChangeEvent, locale: Locale): EventView {
  const offering = model.offeringsById.get(event.offeringId);
  return {
    id: event.id,
    type: event.type,
    displayName: event.displayName,
    modelSlug: event.modelSlug,
    vendor: event.vendor,
    vendorName: vendorName(model, event.vendor, locale),
    platformName: platformName(model, event.platform, locale),
    currency: event.currency,
    fields: event.fields,
    detectedAt: event.detectedAt,
    confirmedFromQuarantine: event.confirmedFromQuarantine,
    current:
      event.type === "new_model" && offering
        ? { input: offering.input, output: offering.output }
        : null,
  };
}

/** 计算器可用的报价：在售，且输入价和输出价都已知（或有阶梯价） */
export function calcOfferings(model: SiteModel, locale: Locale): readonly CalcOffering[] {
  return model.offerings
    .filter((o) => (o.input !== null && o.output !== null) || (o.tiers?.length ?? 0) > 0)
    .map((o) => ({
      id: o.id,
      modelSlug: o.modelSlug,
      displayName: o.displayName,
      vendor: o.vendor,
      vendorName: vendorName(model, o.vendor, locale),
      platform: o.platform,
      platformName: platformName(model, o.platform, locale),
      currency: o.currency,
      input: o.input,
      output: o.output,
      cacheRead: o.cacheRead,
      cacheWrite: o.cacheWrite,
      tiers: o.tiers,
    }));
}

export function chartOfferings(
  model: SiteModel,
  info: ModelInfo,
  locale: Locale,
): readonly ChartOffering[] {
  const series = model.data.histories.get(info.slug)?.series ?? {};
  return info.offerings
    .filter((o) => (series[o.id]?.length ?? 0) > 0)
    .map((o) => ({
      id: o.id,
      label: platformName(model, o.platform, locale),
      currency: o.currency,
      points: series[o.id] ?? [],
    }));
}

export interface MediaEventView {
  readonly id: string;
  readonly type: ChangeEvent["type"];
  readonly displayName: string;
  readonly vendorName: string;
  readonly detectedAt: string;
  readonly confirmedFromQuarantine: boolean;
  /** 已格式化：「生成价 $0.100/秒 → $0.0800/秒（-20%）」 */
  readonly fields: readonly string[];
}

function mediaField(
  field: ChangeField,
  unit: MediaUnit,
  event: ChangeEvent,
  locale: Locale,
): string {
  // 输入参考图总是按张计价
  const fieldUnit: MediaUnit = field.field === "input" ? "per_image" : unit;
  const fmt = (v: number | null): string =>
    formatMediaPrice(v, event.currency, fieldUnit, { locale });
  const label = t(locale, field.field === "input" ? "media.field.input" : "media.field.output");
  return `${label} ${fmt(field.old)} → ${fmt(field.new)}（${formatPct(field.pct)}）`;
}

/** 视频/图像变动（不含 context_change），最多 limit 条 */
export function mediaEventViews(
  model: SiteModel,
  events: readonly ChangeEvent[],
  locale: Locale,
  limit = 30,
): readonly MediaEventView[] {
  return events
    .filter((e) => e.type !== "context_change")
    .slice(0, limit)
    .map((e) => {
      const unit = model.media.units.get(e.offeringId) ?? "per_second";
      return {
        id: e.id,
        type: e.type,
        displayName: e.displayName,
        vendorName: vendorName(model, e.vendor, locale),
        detectedAt: e.detectedAt,
        confirmedFromQuarantine: e.confirmedFromQuarantine,
        fields: e.fields.map((f) => mediaField(f, unit, e, locale)),
      };
    });
}
