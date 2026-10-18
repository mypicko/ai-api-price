/**
 * OpenRouter 平台报价（独立平台，同时用于 V7 交叉核对）。
 * 入口：https://openrouter.ai/api/v1/models（公开，无需 Key）
 * 结构要点：data[].id = "vendor/model[:variant]"，pricing.* 为每 token 的字符串价格。
 * - pricing 里有负数（-1 = 动态路由，例如 openrouter/auto）时跳过
 * - 忽略按时段计价的 pricing.overrides，notes 标注「分时段计价」
 * - :free / :batch 等变体作为独立模型：model 加 "-<variant>" 后缀
 * - 只保留 vendor 能匹配 providers.yaml 的条目，未知 vendor 汇总数量后丢弃
 * - 视频报价在单独的 /api/v1/videos/models，解析见 openrouter-videos.ts；该接口失败时只返回文本报价
 * 最后核对：2026-10-18
 */
import type { RawMediaOffering, RawOffering } from "@aipb/shared";
import { z } from "zod";
import { loadProviders } from "../config-files";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import { createVendorMatcher } from "../steps/normalize";
import { OPENROUTER_VIDEOS_URL, parseOpenRouterVideos } from "./openrouter-videos";
import type { Source, SourceContext } from "./types";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
export const TIME_BASED_PRICING_NOTE = "分时段计价";

const PriceString = z.union([z.string(), z.number()]).optional().nullable();
const ModelSchema = z.object({
  id: z.string().regex(/^[^/\s]+\/[^\s]+$/),
  name: z.string().optional(),
  context_length: z.number().int().positive().nullable().optional(),
  architecture: z
    .object({ input_modalities: z.array(z.string()).optional() })
    .loose()
    .optional(),
  pricing: z
    .object({
      prompt: PriceString,
      completion: PriceString,
      input_cache_read: PriceString,
      input_cache_write: PriceString,
      overrides: z.array(z.unknown()).optional(),
    })
    .loose(),
  top_provider: z
    .object({ max_completion_tokens: z.number().int().positive().nullable().optional() })
    .loose()
    .nullable()
    .optional(),
});
type OpenRouterModel = z.infer<typeof ModelSchema>;

const ResponseSchema = z.object({ data: z.array(z.unknown()) });

/** 字符串价格 → 数字；缺失为 null，非法为 NaN */
export function parsePrice(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "number" ? value : Number(value);
}

export interface ParsedId {
  readonly vendor: string;
  readonly model: string;
  /** 去掉 :variant 的 ID，用于 sourceUrl */
  readonly baseId: string;
}

/** "openai/gpt-4o:free" → { vendor: "openai", model: "gpt-4o-free", baseId: "openai/gpt-4o" } */
export function parseModelId(id: string): ParsedId {
  const [baseId = id, variant] = id.split(":");
  const slash = baseId.indexOf("/");
  const vendor = baseId.slice(0, slash);
  const name = baseId.slice(slash + 1);
  return { vendor, model: variant ? `${name}-${variant}` : name, baseId };
}

/** "OpenAI: GPT-4o (free)" → "GPT-4o (free)" */
export function cleanDisplayName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const stripped = name.replace(/^[^:]{1,40}:\s+/, "").trim();
  return stripped === "" ? name.trim() : stripped;
}

function toRaw(model: OpenRouterModel): RawOffering | null {
  const { pricing } = model;
  const prices = [
    pricing.prompt,
    pricing.completion,
    pricing.input_cache_read,
    pricing.input_cache_write,
  ].map(parsePrice);
  if (prices.some((p) => p !== null && (!Number.isFinite(p) || p < 0))) return null;
  const [input = null, output = null, cacheRead = null, cacheWrite = null] = prices;
  if (input === null && output === null) return null;
  const { vendor, model: name, baseId } = parseModelId(model.id);
  const displayName = cleanDisplayName(model.name);
  const raw: RawOffering = {
    vendorHint: vendor,
    modelName: name,
    currency: "USD",
    unit: "per_token",
    input,
    output,
    cacheRead,
    cacheWrite,
    contextWindow: model.context_length ?? null,
    maxOutput: model.top_provider?.max_completion_tokens ?? null,
    modalities: model.architecture?.input_modalities ?? ["text"],
    sourceUrl: `https://openrouter.ai/${baseId}`,
    ...(displayName === undefined ? {} : { displayName }),
  };
  return (pricing.overrides?.length ?? 0) > 0 ? { ...raw, notes: TIME_BASED_PRICING_NOTE } : raw;
}

export interface OpenRouterParseOptions {
  readonly isKnownVendor: (vendor: string) => boolean;
  readonly logger: Logger;
}

export function parseOpenRouter(data: unknown, options: OpenRouterParseOptions): RawOffering[] {
  const response = ResponseSchema.safeParse(data);
  if (!response.success)
    throw new PipelineError("E2001", "openrouter：响应缺少 data 数组", { sourceId: "openrouter" });
  const parsed = response.data.data.flatMap((item) => {
    const result = ModelSchema.safeParse(item);
    const raw = result.success ? toRaw(result.data) : null;
    return raw ? [raw] : [];
  });
  const known = parsed.filter((o) => options.isKnownVendor(o.vendorHint));
  const unknown = parsed.filter((o) => !options.isKnownVendor(o.vendorHint));
  if (unknown.length > 0) {
    const vendors = [...new Set(unknown.map((o) => o.vendorHint))].toSorted();
    options.logger.debug("openrouter：丢弃未知厂商的条目", {
      sourceId: "openrouter",
      count: unknown.length,
      vendors,
    });
  }
  return known;
}

/** 视频接口是附加数据：失败时记日志、返回空数组，不影响文本报价 */
async function fetchVideos(
  ctx: SourceContext,
  isKnownVendor: (vendor: string) => boolean,
): Promise<readonly RawMediaOffering[]> {
  try {
    const data = await ctx.http.getJson(OPENROUTER_VIDEOS_URL, { timeoutMs: 30_000 });
    return parseOpenRouterVideos(data, { isKnownVendor, logger: ctx.logger });
  } catch (error) {
    ctx.logger.warn("openrouter：视频接口抓取失败，本次只返回文本报价", {
      sourceId: "openrouter",
      error,
    });
    return [];
  }
}

export const openrouterSource: Source = {
  id: "openrouter",
  platform: "openrouter",
  kind: "api",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const matchVendor = createVendorMatcher(await loadProviders(ctx.rootDir));
    const isKnownVendor = (v: string): boolean => matchVendor(v) !== null;
    const [data, videos] = await Promise.all([
      ctx.http.getJson(OPENROUTER_URL, { timeoutMs: 30_000 }),
      fetchVideos(ctx, isKnownVendor),
    ]);
    const offerings = parseOpenRouter(data, { isKnownVendor, logger: ctx.logger });
    if (offerings.length === 0)
      throw new PipelineError("E2001", "openrouter：没有解析出任何报价", {
        sourceId: "openrouter",
      });
    ctx.logger.info("openrouter 解析完成", {
      sourceId: "openrouter",
      count: offerings.length,
      videoCount: videos.length,
    });
    return [...offerings, ...videos];
  },
};
