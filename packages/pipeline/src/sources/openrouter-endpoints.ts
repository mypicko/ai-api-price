/**
 * OpenRouter 服务商报价：同一个模型在 DeepInfra、Together、Groq、Bedrock… 各家的价格。
 * 入口：模型列表 https://openrouter.ai/api/v1/models，逐个请求 /api/v1/models/{id}/endpoints（公开，无需 Key）。
 * - 多平台数据源：provider_name 用 providers.yaml 的 platforms[].matchers 识别成平台；
 *   未配置的服务商（含国内中转站、厂商自营端点如 DeepSeek / Moonshot AI）跳过
 * - 只处理研发厂商能识别的模型；:free 等变体跳过（服务商价格与变体无关）
 * - 同一服务商有多个端点（不同量化 / 区域）时取输入价最低的一个，量化方式写进 notes
 * - 单个模型请求失败只跳过该模型；全部失败时报 E2001
 * - 请求量约等于模型数（几百次），openrouter.ai 的请求间隔在 index.ts 里放宽到 200ms
 * 最后核对：2026-10-19
 */
import type { RawOffering } from "@aipb/shared";
import { z } from "zod";
import { loadProviders } from "../config-files";
import { PipelineError } from "../core/errors";
import { createVendorMatcher } from "../steps/normalize";
import { createPlatformMatcher, type PlatformMatcher } from "./litellm-resellers";
import { OPENROUTER_URL, cleanDisplayName, parsePrice } from "./openrouter";
import { MULTI_PLATFORM, type Source, type SourceContext } from "./types";

export function endpointsUrl(modelId: string): string {
  return `https://openrouter.ai/api/v1/models/${modelId}/endpoints`;
}

const PriceString = z.union([z.string(), z.number()]).optional().nullable();
const EndpointSchema = z
  .object({
    provider_name: z.string(),
    pricing: z
      .object({
        prompt: PriceString,
        completion: PriceString,
        input_cache_read: PriceString,
        input_cache_write: PriceString,
      })
      .loose(),
    context_length: z.number().int().positive().nullable().optional(),
    max_completion_tokens: z.number().int().positive().nullable().optional(),
    quantization: z.string().nullable().optional(),
  })
  .loose();
type Endpoint = z.infer<typeof EndpointSchema>;

const EndpointsResponseSchema = z.object({
  data: z.object({ name: z.string().optional(), endpoints: z.array(z.unknown()) }).loose(),
});

const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string() }).loose()),
});

export interface EndpointParseOptions {
  readonly modelId: string;
  readonly vendorHint: string;
  readonly matchPlatform: PlatformMatcher;
}

const BASE_NOTE = "经 OpenRouter 的服务商报价";

function hasNegativePrice(e: Endpoint): boolean {
  return [e.pricing.prompt, e.pricing.completion].some((v) => (parsePrice(v) ?? 0) < 0);
}

function toRaw(
  e: Endpoint,
  platformId: string,
  options: EndpointParseOptions,
  name?: string,
): RawOffering {
  const modelName = options.modelId.slice(options.modelId.indexOf("/") + 1);
  const quant = e.quantization && e.quantization !== "unknown" ? `（${e.quantization}）` : "";
  const displayName = cleanDisplayName(name);
  return {
    vendorHint: options.vendorHint,
    modelName,
    ...(displayName === undefined ? {} : { displayName }),
    platform: platformId,
    currency: "USD",
    unit: "per_token",
    input: parsePrice(e.pricing.prompt),
    output: parsePrice(e.pricing.completion),
    cacheRead: parsePrice(e.pricing.input_cache_read),
    cacheWrite: parsePrice(e.pricing.input_cache_write),
    contextWindow: e.context_length ?? null,
    maxOutput: e.max_completion_tokens ?? null,
    sourceUrl: `https://openrouter.ai/${options.modelId}/providers`,
    notes: `${BASE_NOTE}${quant}`,
  };
}

/** 一个模型的 endpoints 响应 → 每个已配置服务商一条报价 */
export function parseEndpoints(data: unknown, options: EndpointParseOptions): RawOffering[] {
  const parsed = EndpointsResponseSchema.safeParse(data);
  if (!parsed.success) return [];
  const best = new Map<string, RawOffering>();
  for (const item of parsed.data.data.endpoints) {
    const endpoint = EndpointSchema.safeParse(item);
    if (!endpoint.success || hasNegativePrice(endpoint.data)) continue;
    const platform = options.matchPlatform(endpoint.data.provider_name);
    if (!platform) continue;
    const raw = toRaw(endpoint.data, platform.id, options, parsed.data.data.name);
    const current = best.get(platform.id);
    if (!current || (raw.input ?? Infinity) < (current.input ?? Infinity))
      best.set(platform.id, raw);
  }
  return [...best.values()];
}

interface ModelTarget {
  readonly id: string;
  readonly vendorHint: string;
}

async function listTargets(
  ctx: SourceContext,
  isKnownVendor: (v: string) => boolean,
): Promise<ModelTarget[]> {
  const list = ModelListSchema.safeParse(
    await ctx.http.getJson(OPENROUTER_URL, { timeoutMs: 30_000 }),
  );
  if (!list.success)
    throw new PipelineError("E2001", "openrouter-endpoints：模型列表格式不对", {
      sourceId: "openrouter-endpoints",
    });
  return list.data.data
    .map((m) => m.id)
    .filter((id) => /^[^/:\s]+\/[^:\s]+$/.test(id))
    .map((id) => ({ id, vendorHint: id.slice(0, id.indexOf("/")) }))
    .filter((t) => isKnownVendor(t.vendorHint));
}

export const openrouterEndpointsSource: Source = {
  id: "openrouter-endpoints",
  platform: MULTI_PLATFORM,
  kind: "api",
  timeoutMs: 300_000,
  async fetch(ctx) {
    const providers = await loadProviders(ctx.rootDir);
    const matchVendor = createVendorMatcher(providers);
    const matchPlatform = createPlatformMatcher(providers.platforms);
    const targets = await listTargets(ctx, (v) => matchVendor(v) !== null);
    let failed = 0;
    const perModel = await Promise.all(
      targets.map(async (t) => {
        try {
          const data = await ctx.http.getJson(endpointsUrl(t.id), { timeoutMs: 20_000 });
          return parseEndpoints(data, { modelId: t.id, vendorHint: t.vendorHint, matchPlatform });
        } catch (error) {
          failed += 1;
          ctx.logger.debug("openrouter-endpoints：模型请求失败，跳过", { model: t.id, error });
          return [];
        }
      }),
    );
    if (targets.length > 0 && failed === targets.length)
      throw new PipelineError("E2001", "openrouter-endpoints：所有模型的服务商列表都请求失败", {
        sourceId: "openrouter-endpoints",
      });
    const offerings = perModel.flat();
    ctx.logger.info("openrouter-endpoints 解析完成", {
      sourceId: "openrouter-endpoints",
      models: targets.length,
      failed,
      count: offerings.length,
    });
    return offerings;
  },
};
