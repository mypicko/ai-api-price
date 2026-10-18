/**
 * 公开 JSON 接口（API 文档 §1.2、§2）。所有接口统一使用 {success, data, error, meta} 外层结构。
 */
import {
  SCHEMA_VERSION,
  type ChangeEvent,
  type FxRate,
  type HistoryFile,
  type StatusFile,
} from "@aipb/shared";
import type { PublicOffering } from "./derive";
import type { PublicMediaOffering } from "./media";
import { eventsWithinDays, sortEvents, type ModelInfo, type SiteModel } from "./site-model";

export interface ApiMeta {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly dataDate: string;
  readonly count?: number;
  readonly fxRate?: {
    readonly usdCny: number;
    readonly date: string;
    readonly provider: FxRate["provider"];
  };
}

export interface ApiEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly error: null;
  readonly meta: ApiMeta;
}

export const RECENT_CHANGES_DAYS = 90;

export function baseMeta(model: SiteModel, extra: Partial<ApiMeta> = {}): ApiMeta {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: model.generatedAt,
    dataDate: model.dataDate,
    ...extra,
  };
}

export function envelope<T>(data: T, meta: ApiMeta): ApiEnvelope<T> {
  return { success: true, data, error: null, meta };
}

export function jsonResponse(body: unknown): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 2.1 全部当前报价（不含 removed） */
export function latestPayload(
  model: SiteModel,
): ApiEnvelope<{ offerings: readonly PublicOffering[] }> {
  const fx = model.data.fx.latest;
  return envelope(
    { offerings: model.offerings },
    baseMeta(model, {
      count: model.offerings.length,
      fxRate: { usdCny: fx.usdCny, date: fx.date, provider: fx.provider },
    }),
  );
}

/** 2.9 视频/图像生成报价（不含 removed）；价格按 unit 计价，与 latest.json 的每百万 token 不同 */
export function mediaPayload(
  model: SiteModel,
): ApiEnvelope<{ offerings: readonly PublicMediaOffering[] }> {
  const fx = model.data.fx.latest;
  const offerings = model.media.offerings;
  return envelope(
    { offerings },
    baseMeta(model, {
      count: offerings.length,
      fxRate: { usdCny: fx.usdCny, date: fx.date, provider: fx.provider },
    }),
  );
}

/** 2.10 视频/图像最近 90 天变动 */
export function mediaChangesPayload(
  model: SiteModel,
): ApiEnvelope<{ events: readonly ChangeEvent[] }> {
  const events = eventsWithinDays(model.media.events, model.generatedAt, RECENT_CHANGES_DAYS);
  return envelope({ events }, baseMeta(model, { count: events.length }));
}

export interface PublicVendor {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly region: "intl" | "cn";
  readonly website: string;
  readonly logo: string | null;
  readonly modelCount: number;
  /** 当前在售的视频/图像模型数（1.1.0 新增） */
  readonly mediaModelCount: number;
}

export interface PublicPlatform {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly website: string | null;
  /** official 官方 / aggregator 聚合平台 / cloud 云平台 / inference 推理服务商 */
  readonly category: "official" | "aggregator" | "cloud" | "inference";
}

/** 2.2 厂商与平台；modelCount = 当前在售的去重模型数 */
export function providersPayload(
  model: SiteModel,
): ApiEnvelope<{ vendors: readonly PublicVendor[]; platforms: readonly PublicPlatform[] }> {
  const counts = Map.groupBy(
    new Set(model.offerings.map((o) => `${o.vendor}\u0000${o.modelSlug}`)),
    (key) => key.slice(0, key.indexOf("\u0000")),
  );
  const mediaCounts = Map.groupBy(new Set(model.media.offerings.map((o) => o.modelSlug)), (slug) =>
    slug.slice(0, slug.indexOf("/")),
  );
  const vendors = model.data.providers.vendors.map((v) => ({
    id: v.id,
    nameZh: v.nameZh,
    nameEn: v.nameEn,
    region: v.region,
    website: v.website,
    logo: v.logo,
    modelCount: counts.get(v.id)?.length ?? 0,
    mediaModelCount: mediaCounts.get(v.id)?.length ?? 0,
  }));
  const platforms = model.data.providers.platforms.map((p) => ({
    id: p.id,
    nameZh: p.nameZh,
    nameEn: p.nameEn,
    website: p.website,
    category: p.category ?? "official",
  }));
  return envelope({ vendors, platforms }, baseMeta(model, { count: vendors.length }));
}

export interface ModelPayload {
  readonly model: {
    readonly slug: string;
    readonly vendor: string;
    readonly displayName: string;
    readonly contextWindow: number | null;
    readonly maxOutput: number | null;
    readonly modalities: readonly string[];
    readonly firstSeenAt: string;
    readonly status: ModelInfo["status"];
  };
  readonly offerings: readonly PublicOffering[];
  readonly history: HistoryFile["series"];
  readonly changes: readonly ChangeEvent[];
}

/** 2.3 单个模型详情与历史（已下架的模型也保留，offerings 里带 status） */
export function modelPayload(model: SiteModel, info: ModelInfo): ApiEnvelope<ModelPayload> {
  return envelope(
    {
      model: {
        slug: info.slug,
        vendor: info.vendor,
        displayName: info.displayName,
        contextWindow: info.contextWindow,
        maxOutput: info.maxOutput,
        modalities: info.modalities,
        firstSeenAt: info.firstSeenAt,
        status: info.status,
      },
      offerings: info.offerings,
      history: model.data.histories.get(info.slug)?.series ?? {},
      changes: model.events.filter((e) => e.modelSlug === info.slug),
    },
    baseMeta(model),
  );
}

/** 2.4 最近 90 天变动，detectedAt 倒序 */
export function changesPayload(model: SiteModel): ApiEnvelope<{ events: readonly ChangeEvent[] }> {
  const events = eventsWithinDays(model.events, model.generatedAt, RECENT_CHANGES_DAYS);
  return envelope({ events }, baseMeta(model, { count: events.length }));
}

export function changeMonths(model: SiteModel): readonly string[] {
  return model.data.changeMonths.map((m) => m.month);
}

/** 2.5 按月变动，结构与 2.4 相同 */
export function changesMonthPayload(
  model: SiteModel,
  month: string,
): ApiEnvelope<{ events: readonly ChangeEvent[] }> {
  const file = model.data.changeMonths.find((m) => m.month === month);
  const events = sortEvents(file?.events ?? []);
  return envelope({ events }, baseMeta(model, { count: events.length }));
}

export function changesIndexPayload(model: SiteModel): ApiEnvelope<{ months: readonly string[] }> {
  const months = changeMonths(model);
  return envelope({ months }, baseMeta(model, { count: months.length }));
}

/** 2.6 汇率 */
export function fxPayload(
  model: SiteModel,
): ApiEnvelope<{ latest: FxRate; history: readonly FxRate[] }> {
  const { latest, history } = model.data.fx;
  return envelope({ latest, history }, baseMeta(model, { count: history.length }));
}

export type StatusPayload = StatusFile | { run: null; sources: []; quarantine: []; warnings: [] };

/** 2.7 数据源健康状态；还没有运行记录时 run 为 null */
export function statusPayload(model: SiteModel): ApiEnvelope<StatusPayload> {
  const status = model.data.status;
  const data: StatusPayload = status ?? { run: null, sources: [], quarantine: [], warnings: [] };
  return envelope(data, baseMeta(model));
}
