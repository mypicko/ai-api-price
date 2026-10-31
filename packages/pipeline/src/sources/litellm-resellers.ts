/**
 * LiteLLM 价格表里的转售价：云平台（Azure、Bedrock、Vertex…）和推理服务商（Together、Fireworks、
 * DeepInfra、Groq…）上的第三方模型报价。与 litellm.ts（厂商直连官方价）读同一个 JSON。
 * - 多平台数据源：每条报价自带 platform，平台由 providers.yaml 的 platforms[].matchers 识别
 * - 只收已配置的平台（不收国内中转站），只收能推断出研发厂商的模型（见 reseller-model.ts）
 * - 同一平台同一模型有多条时（Bedrock 的 us./eu. 跨区域版本、Azure 的 eu/ 数据区），保留不带区域前缀的那条
 * - 证据链接用平台定价页（pricingUrl），没有时用平台官网
 * 最后核对：2026-10-19
 */
import type { PlatformConfig, RawOffering } from "@aipb/shared";
import { z } from "zod";
import { loadProviders } from "../config-files";
import { PipelineError } from "../core/errors";
import { shanghaiDate } from "../steps/dates";
import { buildTiers } from "./litellm";
import { LITELLM_URL, isDeprecated } from "./litellm-shared";
import { AWS_REGION_PATH, inferVendorHint, resellerModelName } from "./reseller-model";
import { MULTI_PLATFORM, type Source } from "./types";

export type PlatformMatcher = (name: string) => PlatformConfig | null;

/** matchers 支持精确匹配和末尾 * 的前缀匹配，不区分大小写 */
export function createPlatformMatcher(platforms: readonly PlatformConfig[]): PlatformMatcher {
  const rules = platforms.flatMap((platform) =>
    (platform.matchers ?? []).map((m) => {
      const key = m.toLowerCase();
      return key.endsWith("*")
        ? { platform, test: (name: string) => name.startsWith(key.slice(0, -1)) }
        : { platform, test: (name: string) => name === key };
    }),
  );
  return (name) => {
    const lower = name.trim().toLowerCase();
    return rules.find((rule) => rule.test(lower))?.platform ?? null;
  };
}

const ACCEPTED_MODES: ReadonlySet<string> = new Set(["chat", "responses"]);
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

export interface ResellerParseOptions {
  readonly today: string;
  readonly matchPlatform: PlatformMatcher;
}

/** 去掉 LiteLLM 自己加的 provider 前缀：「vertex_ai/claude-…」「deepinfra/deepseek-ai/…」 */
function modelPath(key: string, provider: string): string {
  const [first, ...rest] = key.split("/");
  if (rest.length === 0 || first === undefined) return key;
  const base = provider.split("-")[0] ?? provider;
  return first === provider || first === base ? rest.join("/") : key;
}

/**
 * Bedrock 的 us./eu. 跨区域版本、按 AWS 区域单列的价格（ap-northeast-1/…，部分区域贵 20%～30%）、
 * Azure 的 eu/ 数据区排在后面，去重时让位给标准版本
 */
function isRegional(path: string): boolean {
  return /^(us|eu|apac|global|us-gov|jp|au|ca)[./]/.test(path) || AWS_REGION_PATH.test(path);
}

function toRaw(path: string, entry: Entry, platform: PlatformConfig): RawOffering | null {
  const vendorHint = inferVendorHint(path);
  if (vendorHint === null) return null;
  const raw: RawOffering = {
    vendorHint,
    modelName: resellerModelName(path),
    platform: platform.id,
    currency: "USD",
    unit: "per_token",
    input: entry.input_cost_per_token ?? null,
    output: entry.output_cost_per_token ?? null,
    cacheRead: entry.cache_read_input_token_cost ?? null,
    cacheWrite: entry.cache_creation_input_token_cost ?? null,
    contextWindow: entry.max_input_tokens ?? null,
    maxOutput: entry.max_output_tokens ?? null,
    modalities: entry.supported_modalities ?? ["text"],
    sourceUrl: platform.pricingUrl ?? platform.website ?? LITELLM_URL,
  };
  const tiers = buildTiers(entry as Parameters<typeof buildTiers>[0]);
  return tiers ? { ...raw, tiers } : raw;
}

interface Item {
  readonly path: string;
  readonly entry: Entry;
  readonly platform: PlatformConfig;
}

function acceptedItems(data: object, options: ResellerParseOptions): Item[] {
  return Object.entries(data).flatMap(([key, value]) => {
    const parsed = EntrySchema.safeParse(value);
    if (!parsed.success || key === "sample_spec" || key.startsWith("ft:")) return [];
    const entry = parsed.data;
    if (!ACCEPTED_MODES.has(entry.mode) || isDeprecated(entry, options.today)) return [];
    if (entry.input_cost_per_token === undefined && entry.output_cost_per_token === undefined)
      return [];
    const platform = options.matchPlatform(entry.litellm_provider);
    return platform ? [{ path: modelPath(key, entry.litellm_provider), entry, platform }] : [];
  });
}

export function parseLitellmResellers(data: unknown, options: ResellerParseOptions): RawOffering[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new PipelineError("E2001", "litellm-resellers：响应不是对象", {
      sourceId: "litellm-resellers",
    });
  }
  const items = acceptedItems(data, options).toSorted(
    (a, b) => Number(isRegional(a.path)) - Number(isRegional(b.path)),
  );
  const seen = new Set<string>();
  return items.flatMap(({ path, entry, platform }) => {
    const raw = toRaw(path, entry, platform);
    if (!raw) return [];
    const key = `${platform.id}|${raw.vendorHint}|${raw.modelName.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [raw];
  });
}

export const litellmResellersSource: Source = {
  id: "litellm-resellers",
  platform: MULTI_PLATFORM,
  kind: "api",
  timeoutMs: 60_000,
  async fetch(ctx) {
    const providers = await loadProviders(ctx.rootDir);
    const data = await ctx.http.getJson(LITELLM_URL, { timeoutMs: 45_000 });
    const offerings = parseLitellmResellers(data, {
      today: shanghaiDate(ctx.now),
      matchPlatform: createPlatformMatcher(providers.platforms),
    });
    if (offerings.length === 0)
      throw new PipelineError("E2001", "litellm-resellers：没有解析出任何报价", {
        sourceId: "litellm-resellers",
      });
    ctx.logger.info("litellm-resellers 解析完成", {
      sourceId: "litellm-resellers",
      count: offerings.length,
      platforms: new Set(offerings.map((o) => o.platform)).size,
    });
    return offerings;
  },
};
