/**
 * models.dev 社区模型数据库（MIT，github.com/anomalyco/models.dev），用来补充海外抓不到的国内站价格。
 * 入口：https://models.dev/api.json（公开，无需 Key，约 2MB）
 * 结构要点：{ <providerId>: { name, doc, models: { <modelId>: { name, cost, limit, modalities, status } } } }
 * - cost 单位：USD / 每百万 token。国内站（*-cn）条目是社区把人民币原价换算成的美元，notes 里注明
 * - cost.tiers[].tier = { type: "context", size }：上下文超过 size 后使用该档价格
 * - 只收文本输入、文本输出且有价格的模型；跳过 status = deprecated
 * - 两个源（official-cn、siliconflow-cn）共用同一次下载
 * 最后核对：2026-10-18
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import { z } from "zod";
import { loadProviders } from "../config-files";
import { PipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";
import { createVendorMatcher } from "../steps/normalize";
import type { Source, SourceContext } from "./types";

export const MODELSDEV_URL = "https://models.dev/api.json";
const MODELSDEV_HOME = "https://models.dev";

export type ModelsDevPlatform = "official-cn" | "siliconflow-cn";

/** models.dev provider → 我们的平台；vendorHint 为 null 时从模型 ID 前缀（org/model）取 */
const PROVIDER_MAP: Readonly<
  Record<string, { readonly platform: ModelsDevPlatform; readonly vendorHint: string | null }>
> = {
  "alibaba-cn": { platform: "official-cn", vendorHint: "alibaba" },
  "moonshotai-cn": { platform: "official-cn", vendorHint: "moonshot" },
  "minimax-cn": { platform: "official-cn", vendorHint: "minimax" },
  stepfun: { platform: "official-cn", vendorHint: "stepfun" },
  "siliconflow-cn": { platform: "siliconflow-cn", vendorHint: null },
};

const NOTES: Readonly<Record<ModelsDevPlatform, string>> = {
  "official-cn": "models.dev 社区数据：国内站人民币原价换算为美元，以官网为准",
  "siliconflow-cn": "models.dev 社区数据：硅基流动国内站人民币原价换算为美元，以官网为准",
};

const Price = z.number().nonnegative().finite();
const CostSchema = z
  .object({
    input: Price,
    output: Price,
    cache_read: Price.optional(),
    cache_write: Price.optional(),
    tiers: z.array(z.unknown()).optional(),
  })
  .loose();
type Cost = z.infer<typeof CostSchema>;

const TierEntrySchema = z
  .object({
    input: Price,
    output: Price,
    cache_read: Price.optional(),
    cache_write: Price.optional(),
    tier: z.object({ type: z.string(), size: z.number().int().positive() }),
  })
  .loose();

const ModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    status: z.string().optional(),
    cost: CostSchema.optional(),
    limit: z
      .object({ context: z.number().optional(), output: z.number().optional() })
      .loose()
      .optional(),
    modalities: z
      .object({ input: z.array(z.string()), output: z.array(z.string()) })
      .loose()
      .optional(),
  })
  .loose();
type ModelsDevModel = z.infer<typeof ModelSchema>;

const ProviderSchema = z
  .object({ doc: z.string().optional(), models: z.record(z.string(), z.unknown()) })
  .loose();

const positiveOrNull = (n: number | undefined): number | null =>
  n !== undefined && Number.isInteger(n) && n > 0 ? n : null;

/** 基础价 + 按上下文的分档 → tiers；没有可用分档时返回 undefined */
interface PriceLevel {
  readonly input: number;
  readonly output: number;
  readonly cache_read?: number | undefined;
  readonly cache_write?: number | undefined;
}

export function toTiers(
  base: PriceLevel,
  tiers: readonly unknown[] | undefined,
): RawTier[] | undefined {
  const parsed = (tiers ?? [])
    .map((t) => TierEntrySchema.safeParse(t))
    .flatMap((r) => (r.success && r.data.tier.type === "context" ? [r.data] : []))
    .toSorted((a, b) => a.tier.size - b.tier.size);
  if (parsed.length === 0) return undefined;
  const levels = [{ ...base, start: 0 }, ...parsed.map((t) => ({ ...t, start: t.tier.size }))];
  return levels.map((level, i) => ({
    minInputTokens: level.start,
    maxInputTokens: levels[i + 1]?.start ?? null,
    input: level.input,
    output: level.output,
    cacheRead: level.cache_read ?? null,
    cacheWrite: level.cache_write ?? null,
  }));
}

function isTextChatModel(model: ModelsDevModel): model is ModelsDevModel & { cost: Cost } {
  const io = model.modalities;
  return (
    model.cost !== undefined &&
    model.status !== "deprecated" &&
    (io?.input.includes("text") ?? false) &&
    (io?.output.includes("text") ?? false)
  );
}

function splitOrgId(id: string): { vendorHint: string; modelName: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { vendorHint: id.slice(0, slash), modelName: id.slice(slash + 1) };
}

function toRaw(
  model: ModelsDevModel & { cost: Cost },
  names: { vendorHint: string; modelName: string },
  platform: ModelsDevPlatform,
  sourceUrl: string,
): RawOffering {
  const { cost } = model;
  const tiers = toTiers(cost, cost.tiers);
  return {
    vendorHint: names.vendorHint,
    modelName: names.modelName,
    ...(model.name === undefined ? {} : { displayName: model.name }),
    currency: "USD",
    unit: "per_1m",
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache_read ?? null,
    cacheWrite: cost.cache_write ?? null,
    ...(tiers === undefined ? {} : { tiers }),
    contextWindow: positiveOrNull(model.limit?.context),
    maxOutput: positiveOrNull(model.limit?.output),
    modalities: model.modalities?.input ?? ["text"],
    sourceUrl,
    notes: NOTES[platform],
  };
}

function providerOfferings(
  providerId: string,
  provider: z.infer<typeof ProviderSchema>,
  platform: ModelsDevPlatform,
  vendorHint: string | null,
): RawOffering[] {
  const sourceUrl = provider.doc?.startsWith("https://") ? provider.doc : MODELSDEV_HOME;
  return Object.values(provider.models).flatMap((item) => {
    const parsed = ModelSchema.safeParse(item);
    if (!parsed.success || !isTextChatModel(parsed.data)) return [];
    const names = vendorHint
      ? { vendorHint, modelName: parsed.data.id }
      : splitOrgId(parsed.data.id);
    if (!names) return [];
    return [toRaw(parsed.data, names, platform, sourceUrl)];
  });
}

export interface ModelsDevParseOptions {
  readonly isKnownVendor: (vendor: string) => boolean;
  readonly logger: Logger;
}

export function parseModelsDev(
  data: unknown,
  platform: ModelsDevPlatform,
  options: ModelsDevParseOptions,
): RawOffering[] {
  const root = z.record(z.string(), z.unknown()).safeParse(data);
  if (!root.success || Array.isArray(data))
    throw new PipelineError("E2001", "modelsdev：响应不是 provider 对象", {
      sourceId: "modelsdev",
    });
  const offerings = Object.entries(PROVIDER_MAP)
    .filter(([, mapping]) => mapping.platform === platform)
    .flatMap(([providerId, mapping]) => {
      const provider = ProviderSchema.safeParse(root.data[providerId]);
      return provider.success
        ? providerOfferings(providerId, provider.data, platform, mapping.vendorHint)
        : [];
    });
  const unknown = offerings.filter((o) => !options.isKnownVendor(o.vendorHint));
  if (unknown.length > 0) {
    options.logger.debug("modelsdev：丢弃未知厂商的条目", {
      platform,
      count: unknown.length,
      vendors: [...new Set(unknown.map((o) => o.vendorHint))].toSorted(),
    });
  }
  return offerings.filter((o) => options.isKnownVendor(o.vendorHint));
}

/** 同一个 HttpClient（即同一次运行）只下载一次 api.json */
const downloads = new WeakMap<HttpClient, Promise<unknown>>();

function download(http: HttpClient): Promise<unknown> {
  const cached = downloads.get(http);
  if (cached) return cached;
  const pending = http.getJson(MODELSDEV_URL, { timeoutMs: 45_000 });
  downloads.set(http, pending);
  pending.catch(() => downloads.delete(http));
  return pending;
}

function createModelsDevSource(id: string, platform: ModelsDevPlatform): Source {
  return {
    id,
    platform,
    kind: "api",
    timeoutMs: 60_000,
    async fetch(ctx: SourceContext) {
      const matchVendor = createVendorMatcher(await loadProviders(ctx.rootDir));
      const offerings = parseModelsDev(await download(ctx.http), platform, {
        isKnownVendor: (v) => matchVendor(v) !== null,
        logger: ctx.logger,
      });
      if (offerings.length === 0)
        throw new PipelineError("E2001", `${id}：没有解析出任何报价`, { sourceId: id });
      ctx.logger.info(`${id} 解析完成`, { sourceId: id, count: offerings.length });
      return offerings;
    },
  };
}

export const modelsdevCnSource = createModelsDevSource("modelsdev-cn", "official-cn");
export const modelsdevSiliconflowCnSource = createModelsDevSource(
  "modelsdev-siliconflow-cn",
  "siliconflow-cn",
);
