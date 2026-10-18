/**
 * LiteLLM 社区维护的价格表：国际厂商「官方价」的主要来源。
 * 入口：https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 * 结构要点：对象，键为模型名（可能带 "provider/" 前缀），值含 litellm_provider / mode / *_cost_per_token。
 * - 只收 mode = chat / responses，且 litellm_provider 是厂商直连（排除 bedrock/azure/vertex/openrouter 等转售方）
 * - 价格单位 per_token；*_above_<N>k_tokens 字段转成阶梯价
 * - 去掉 sample_spec、fine-tune（ft:）条目，以及 deprecation_date 早于今天的条目
 * - 视频/图像生成条目见 litellm-media.ts，与文本报价一起返回
 * 最后核对：2026-10-18
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import { z } from "zod";
import { loadProviders } from "../config-files";
import { PipelineError } from "../core/errors";
import { shanghaiDate } from "../steps/dates";
import { createVendorMatcher, isAllowedSourceUrl } from "../steps/normalize";
import { parseLitellmMedia } from "./litellm-media";
import { LITELLM_URL, isDeprecated, type LitellmParseOptions } from "./litellm-shared";
import type { Source } from "./types";

export { LITELLM_URL, isDeprecated, type LitellmParseOptions };

/** litellm_provider → vendorHint（与 providers.yaml 的 matchers 对应） */
export const DIRECT_PROVIDERS: Readonly<Record<string, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  xai: "xai",
  mistral: "mistral",
  codestral: "mistral",
  cohere: "cohere",
  cohere_chat: "cohere",
  deepseek: "deepseek",
  meta_llama: "meta",
  amazon_nova: "amazon",
  minimax: "minimax",
};

const ACCEPTED_MODES: ReadonlySet<string> = new Set(["chat", "responses"]);
const PRICE_KEYS = {
  input: "input_cost_per_token",
  output: "output_cost_per_token",
  cacheRead: "cache_read_input_token_cost",
  cacheWrite: "cache_creation_input_token_cost",
} as const;
type PriceKey = keyof typeof PRICE_KEYS;
const TIER_KEY =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_(\d+)k_tokens$/;

const Cost = z.number().nonnegative().finite();
const EntrySchema = z
  .object({
    litellm_provider: z.string(),
    mode: z.string(),
    input_cost_per_token: Cost.optional(),
    output_cost_per_token: Cost.optional(),
    cache_read_input_token_cost: Cost.optional(),
    cache_creation_input_token_cost: Cost.optional(),
    max_input_tokens: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    supported_modalities: z.array(z.string()).optional(),
    deprecation_date: z.string().optional(),
  })
  .loose();
type Entry = z.infer<typeof EntrySchema>;

/** "gemini/gemini-2.5-pro" → "gemini-2.5-pro" */
export function stripProviderPrefix(key: string): string {
  return key.split("/").at(-1) ?? key;
}

function priceOf(entry: Entry, key: PriceKey): number | null {
  return entry[PRICE_KEYS[key]] ?? null;
}

/** 把 *_above_<N>k_tokens 字段转成阶梯价；没有阶梯时返回 undefined */
export function buildTiers(entry: Entry): RawTier[] | undefined {
  const record = entry as Record<string, unknown>;
  const thresholds = [
    ...new Set(
      Object.keys(record).flatMap((k) => {
        const match = TIER_KEY.exec(k);
        return match?.[2] ? [Number(match[2]) * 1000] : [];
      }),
    ),
  ].toSorted((a, b) => a - b);
  if (thresholds.length === 0) return undefined;
  const at = (key: PriceKey, threshold: number): number | null => {
    const value = record[`${PRICE_KEYS[key]}_above_${threshold / 1000}k_tokens`];
    return typeof value === "number" && value >= 0 ? value : null;
  };
  const base: RawTier = {
    minInputTokens: 0,
    maxInputTokens: thresholds[0] ?? null,
    input: priceOf(entry, "input"),
    output: priceOf(entry, "output"),
    cacheRead: priceOf(entry, "cacheRead"),
    cacheWrite: priceOf(entry, "cacheWrite"),
  };
  const upper = thresholds.map((threshold, i) => ({
    minInputTokens: threshold,
    maxInputTokens: thresholds[i + 1] ?? null,
    input: at("input", threshold),
    output: at("output", threshold),
    cacheRead: at("cacheRead", threshold),
    cacheWrite: at("cacheWrite", threshold),
  }));
  return [base, ...upper];
}

function toRaw(key: string, entry: Entry, options: LitellmParseOptions): RawOffering | null {
  const vendorHint = DIRECT_PROVIDERS[entry.litellm_provider];
  if (vendorHint === undefined || !ACCEPTED_MODES.has(entry.mode)) return null;
  if (key.startsWith("ft:") || isDeprecated(entry, options.today)) return null;
  if (entry.input_cost_per_token === undefined && entry.output_cost_per_token === undefined)
    return null;
  const tiers = buildTiers(entry);
  const raw: RawOffering = {
    vendorHint,
    modelName: stripProviderPrefix(key),
    currency: "USD",
    unit: "per_token",
    input: priceOf(entry, "input"),
    output: priceOf(entry, "output"),
    cacheRead: priceOf(entry, "cacheRead"),
    cacheWrite: priceOf(entry, "cacheWrite"),
    contextWindow: entry.max_input_tokens ?? null,
    maxOutput: entry.max_output_tokens ?? null,
    modalities: entry.supported_modalities ?? ["text"],
    sourceUrl: options.pricingUrlFor(vendorHint) ?? LITELLM_URL,
  };
  return tiers ? { ...raw, tiers } : raw;
}

/** 同名模型（例如 deepseek-chat 和 deepseek/deepseek-chat）只保留第一条 */
export function parseLitellm(data: unknown, options: LitellmParseOptions): RawOffering[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new PipelineError("E2001", "litellm：响应不是对象", { sourceId: "litellm" });
  }
  const offerings = Object.entries(data).flatMap(([key, value]) => {
    if (key === "sample_spec") return [];
    const parsed = EntrySchema.safeParse(value);
    const raw = parsed.success ? toRaw(key, parsed.data, options) : null;
    return raw ? [raw] : [];
  });
  const seen = new Set<string>();
  return offerings.filter((o) => {
    const k = `${o.vendorHint}|${o.modelName.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const litellmSource: Source = {
  id: "litellm",
  platform: "official",
  kind: "api",
  timeoutMs: 60_000,
  async fetch(ctx) {
    const providers = await loadProviders(ctx.rootDir);
    const matchVendor = createVendorMatcher(providers);
    const data = await ctx.http.getJson(LITELLM_URL, { timeoutMs: 45_000 });
    const options = {
      today: shanghaiDate(ctx.now),
      pricingUrlFor: (hint: string) => matchVendor(hint)?.pricingUrl ?? null,
      isAllowedUrl: (hint: string, url: string) =>
        isAllowedSourceUrl(url, matchVendor(hint)?.allowedSourceDomains ?? []),
    };
    const offerings = parseLitellm(data, options);
    if (offerings.length === 0)
      throw new PipelineError("E2001", "litellm：没有解析出任何报价", { sourceId: "litellm" });
    // parseLitellm 已确认 data 是对象
    const media = parseLitellmMedia(data as Readonly<Record<string, unknown>>, options);
    ctx.logger.info("litellm 解析完成", {
      sourceId: "litellm",
      count: offerings.length,
      mediaCount: media.length,
    });
    return [...offerings, ...media];
  },
};
