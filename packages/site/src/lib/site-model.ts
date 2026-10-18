/**
 * 把 SiteData 整理成页面需要的视图模型（构建时运行）。
 */
import type {
  ChangeEvent,
  HistoryFile,
  MediaUnit,
  Offering,
  OfferingStatus,
  PlatformConfig,
  Region,
  VendorConfig,
} from "@aipb/shared";
import { primaryChange, toPublicOffering, type PublicOffering } from "./derive";
import { daysBetween, shanghaiDate } from "./i18n";
import type { SiteData } from "./load-data";
import {
  toMediaRow,
  toPublicMediaOffering,
  type MediaRow,
  type PublicMediaOffering,
} from "./media";
import type { Locale } from "./locale";
import type { TableRow } from "./table";

export interface ModelInfo {
  readonly slug: string;
  readonly vendor: string;
  readonly model: string;
  readonly displayName: string;
  readonly contextWindow: number | null;
  readonly maxOutput: number | null;
  readonly modalities: readonly string[];
  readonly firstSeenAt: string;
  readonly status: OfferingStatus;
  /** 含 removed，按平台排序（官方优先） */
  readonly offerings: readonly PublicOffering[];
  readonly rawOfferings: readonly Offering[];
}

export interface SiteModel {
  readonly data: SiteData;
  readonly hasData: boolean;
  readonly generatedAt: string;
  readonly dataDate: string;
  readonly usdCny: number;
  readonly fxDate: string;
  /** 全部（含 removed） */
  readonly allOfferings: readonly PublicOffering[];
  /** 公开（不含 removed） */
  readonly offerings: readonly PublicOffering[];
  readonly offeringsById: ReadonlyMap<string, PublicOffering>;
  readonly vendors: ReadonlyMap<string, VendorConfig>;
  readonly platforms: ReadonlyMap<string, PlatformConfig>;
  readonly models: readonly ModelInfo[];
  /** 全部事件，detectedAt 倒序 */
  readonly events: readonly ChangeEvent[];
  readonly media: MediaModel;
}

/** 视频/图像报价（data/media/） */
export interface MediaModel {
  readonly hasData: boolean;
  readonly generatedAt: string | null;
  /** 公开（不含 removed） */
  readonly offerings: readonly PublicMediaOffering[];
  /** 全部事件，detectedAt 倒序 */
  readonly events: readonly ChangeEvent[];
  /** offeringId → 计价单位（含已下架，变动记录用） */
  readonly units: ReadonlyMap<string, MediaUnit>;
}

const STATUS_RANK: Readonly<Record<OfferingStatus, number>> = { active: 0, missing: 1, removed: 2 };

export function platformRank(platform: string): number {
  return platform === "official" ? 0 : 1;
}

function compareOfferings(
  a: { platform: string; id: string },
  b: { platform: string; id: string },
): number {
  return platformRank(a.platform) - platformRank(b.platform) || a.id.localeCompare(b.id);
}

export function sortEvents(events: readonly ChangeEvent[]): readonly ChangeEvent[] {
  return events.toSorted(
    (a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id),
  );
}

function modelStatus(offerings: readonly Offering[]): OfferingStatus {
  return (
    offerings.map((o) => o.status).toSorted((a, b) => STATUS_RANK[a] - STATUS_RANK[b])[0] ??
    "removed"
  );
}

function buildModel(
  raw: readonly Offering[],
  publicById: ReadonlyMap<string, PublicOffering>,
): ModelInfo {
  const sorted = raw.toSorted(compareOfferings);
  const primary = sorted.find((o) => o.status !== "removed") ?? sorted[0];
  if (!primary) throw new Error("buildModel: 空的报价列表");
  return {
    slug: primary.modelSlug,
    vendor: primary.vendor,
    model: primary.model,
    displayName: primary.displayName,
    contextWindow:
      primary.contextWindow ?? sorted.find((o) => o.contextWindow !== null)?.contextWindow ?? null,
    maxOutput: primary.maxOutput ?? sorted.find((o) => o.maxOutput !== null)?.maxOutput ?? null,
    modalities: [...new Set(sorted.flatMap((o) => o.modalities))],
    firstSeenAt: sorted.map((o) => o.firstSeenAt).toSorted()[0] ?? primary.firstSeenAt,
    status: modelStatus(sorted),
    offerings: sorted
      .map((o) => publicById.get(o.id))
      .filter((o): o is PublicOffering => o !== undefined),
    rawOfferings: sorted,
  };
}

export function buildModels(
  offerings: readonly Offering[],
  publicById: ReadonlyMap<string, PublicOffering>,
): readonly ModelInfo[] {
  const groups = Map.groupBy(offerings, (o) => o.modelSlug);
  return [...groups.values()]
    .map((group) => buildModel(group, publicById))
    .toSorted((a, b) => a.slug.localeCompare(b.slug));
}

function buildMediaModel(data: SiteData, usdCny: number, dataDate: string): MediaModel {
  const { latest, histories, changeMonths } = data.media;
  const ctx = { usdCny, dataDate: latest?.dataDate ?? dataDate, histories };
  const offerings = (latest?.offerings ?? [])
    .filter((o) => o.status !== "removed")
    .map((o) => toPublicMediaOffering(o, ctx));
  return {
    hasData: offerings.length > 0,
    generatedAt: latest?.generatedAt ?? null,
    offerings,
    events: sortEvents(changeMonths.flatMap((m) => m.events)),
    units: new Map((latest?.offerings ?? []).map((o) => [o.id, o.unit] as const)),
  };
}

export function buildSiteModel(data: SiteData, now: string = new Date().toISOString()): SiteModel {
  const latest = data.latest;
  const generatedAt = latest?.generatedAt ?? now;
  const dataDate = latest?.dataDate ?? shanghaiDate(now);
  const usdCny = data.fx.latest.usdCny;
  const ctx = { usdCny, dataDate, histories: data.histories };
  const raw = latest?.offerings ?? [];
  const allOfferings = raw.map((o) => toPublicOffering(o, ctx));
  const byId = new Map(allOfferings.map((o) => [o.id, o]));
  return {
    data,
    hasData: allOfferings.some((o) => o.status !== "removed"),
    generatedAt,
    dataDate,
    usdCny,
    fxDate: data.fx.latest.date,
    allOfferings,
    offerings: allOfferings.filter((o) => o.status !== "removed"),
    offeringsById: byId,
    vendors: new Map(data.providers.vendors.map((v) => [v.id, v])),
    platforms: new Map(data.providers.platforms.map((p) => [p.id, p])),
    models: buildModels(raw, byId),
    events: sortEvents(data.changeMonths.flatMap((m) => m.events)),
    media: buildMediaModel(data, usdCny, dataDate),
  };
}

export function vendorName(model: SiteModel, id: string, locale: Locale): string {
  const vendor = model.vendors.get(id);
  if (!vendor) return id;
  return locale === "zh" ? vendor.nameZh : vendor.nameEn;
}

export function vendorRegion(model: SiteModel, id: string): Region {
  return model.vendors.get(id)?.region ?? "intl";
}

export function platformName(model: SiteModel, id: string, locale: Locale): string {
  const platform = model.platforms.get(id);
  if (!platform) return id;
  return locale === "zh" ? platform.nameZh : platform.nameEn;
}

export function findModel(model: SiteModel, slug: string): ModelInfo | undefined {
  return model.models.find((m) => m.slug === slug);
}

export function historyFor(model: SiteModel, slug: string): HistoryFile["series"] {
  return model.data.histories.get(slug)?.series ?? {};
}

/** 最近 N 小时内的事件（不含只记录不推送的 context_change） */
export function recentEvents(
  events: readonly ChangeEvent[],
  nowIso: string,
  hours = 24,
  limit = 6,
): { readonly items: readonly ChangeEvent[]; readonly total: number } {
  const since = Date.parse(nowIso) - hours * 3_600_000;
  const matched = events.filter(
    (e) => e.type !== "context_change" && Date.parse(e.detectedAt) >= since,
  );
  return { items: matched.slice(0, limit), total: matched.length };
}

export function eventsWithinDays(
  events: readonly ChangeEvent[],
  nowIso: string,
  days: number,
): readonly ChangeEvent[] {
  const since = Date.parse(nowIso) - days * 86_400_000;
  return events.filter((e) => Date.parse(e.detectedAt) >= since);
}

export interface EventGroup {
  readonly date: string;
  readonly events: readonly ChangeEvent[];
}

/** 按北京时间日期分组，保持输入顺序 */
export function groupEventsByDate(events: readonly ChangeEvent[]): readonly EventGroup[] {
  const groups = Map.groupBy(events, (e) => shanghaiDate(e.detectedAt));
  return [...groups.entries()].map(([date, items]) => ({ date, events: items }));
}

export function staleDays(offering: { readonly fetchedAt: string }, nowIso: string): number {
  return Math.max(0, daysBetween(offering.fetchedAt, nowIso));
}

export function toTableRow(model: SiteModel, offering: PublicOffering, locale: Locale): TableRow {
  return {
    id: offering.id,
    modelSlug: offering.modelSlug,
    model: offering.model,
    displayName: offering.displayName,
    vendor: offering.vendor,
    vendorName: vendorName(model, offering.vendor, locale),
    region: vendorRegion(model, offering.vendor),
    platform: offering.platform,
    platformName: platformName(model, offering.platform, locale),
    currency: offering.currency,
    input: offering.input,
    output: offering.output,
    cacheRead: offering.cacheRead,
    usd: [
      offering.converted.usd.input,
      offering.converted.usd.output,
      offering.converted.usd.cacheRead,
    ],
    cny: [
      offering.converted.cny.input,
      offering.converted.cny.output,
      offering.converted.cny.cacheRead,
    ],
    blendedUsd: offering.blended?.usd ?? null,
    contextWindow: offering.contextWindow,
    change7d: primaryChange(offering.change7d),
    isFree: offering.isFree,
    stale: offering.stale,
    status: offering.status,
    fetchedAt: offering.fetchedAt,
    hasTiers: (offering.tiers?.length ?? 0) > 1,
  };
}

export function toMediaTableRow(
  model: SiteModel,
  offering: PublicMediaOffering,
  locale: Locale,
): MediaRow {
  return toMediaRow(offering, {
    vendorName: vendorName(model, offering.vendor, locale),
    platformName: platformName(model, offering.platform, locale),
  });
}
