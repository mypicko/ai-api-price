/**
 * DeepInfra 官方模型列表（公开，无需 Key）：https://api.deepinfra.com/models/list
 * 直接取平台自己的价格，作为 OpenRouter 服务商列表、LiteLLM 社区价格表之外的第一手来源，
 * 优先级高于两者（见 steps/normalize 的 SOURCE_PRIORITY）。
 * - 只收文本生成、按 token 计价、非私有、未下线的模型
 * - 价格单位是「美分 / token」，换成「美元 / token」
 * - discount 是折扣比例（0.25 = 便宜 25%），实际价 = 标价 × (1 − discount)；
 *   有 discount_ends_at 且已过期的折扣不算。折扣写进 notes
 * - 缓存命中价是输入价的倍率（rate_per_input_token_cached），按折后输入价换算
 * - 取标准档价格；Flex 档（rate_per_service_tier_flex，例如 0.8×，响应较慢）只写进 notes。
 *   OpenRouter 列出的 DeepInfra 价格是 Flex 档，所以会比这里低 20% 左右
 * - 模型路径是 Hugging Face 风格（deepseek-ai/DeepSeek-V3.1），由 reseller-model 识别厂商
 * 最后核对：2026-10-23
 */
import type { RawOffering } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "../core/errors";
import { inferVendorHint, resellerModelName } from "./reseller-model";
import { MULTI_PLATFORM, type Source } from "./types";

export const DEEPINFRA_URL = "https://api.deepinfra.com/models/list";
const SOURCE_ID = "deepinfra";

const Num = z.number().nonnegative().nullable().optional();
const ModelSchema = z
  .object({
    model_name: z.string().min(1),
    type: z.string().nullable().optional(),
    pricing: z
      .object({
        type: z.string().nullable().optional(),
        cents_per_input_token: Num,
        cents_per_output_token: Num,
        rate_per_input_token_cached: Num,
        discount: Num,
        rate_per_service_tier_flex: Num,
        discount_ends_at: z.union([z.string(), z.number()]).nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    max_tokens: z.number().int().positive().nullable().optional(),
    deprecated: z.number().nullable().optional(),
    private: z.union([z.number(), z.boolean()]).nullable().optional(),
    quantization: z.string().nullable().optional(),
  })
  .loose();
type Model = z.infer<typeof ModelSchema>;

/** 美分 / token → 美元 / token；保留足够精度，避免 0.06/1M 这类价格出现浮点尾巴 */
function centsToUsd(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return Number((cents / 100).toPrecision(12));
}

/** 当前生效的折扣比例（0～1，不含 0 和 1）；没有折扣返回 0 */
export function activeDiscount(
  pricing: {
    discount?: number | null | undefined;
    discount_ends_at?: string | number | null | undefined;
  },
  now: Date,
): number {
  const d = pricing.discount;
  if (d === null || d === undefined || !(d > 0 && d < 1)) return 0;
  const ends = pricing.discount_ends_at;
  if (ends === null || ends === undefined) return d;
  const endMs = typeof ends === "number" ? ends * 1000 : Date.parse(ends);
  return Number.isFinite(endMs) && endMs <= now.getTime() ? 0 : d;
}

function isActive(m: Model, nowSec: number): boolean {
  if (m.type !== "text-generation" || m.pricing?.type !== "tokens") return false;
  if (m.private === 1 || m.private === true) return false;
  return m.deprecated === null || m.deprecated === undefined || m.deprecated > nowSec;
}

function toRaw(m: Model, now: Date): RawOffering | null {
  const vendorHint = inferVendorHint(m.model_name);
  const pricing = m.pricing;
  if (vendorHint === null || !pricing) return null;
  const discount = activeDiscount(pricing, now);
  const apply = (cents: number | null | undefined): number | null => {
    const usd = centsToUsd(cents);
    return usd === null ? null : Number((usd * (1 - discount)).toPrecision(12));
  };
  const input = apply(pricing.cents_per_input_token);
  const output = apply(pricing.cents_per_output_token);
  if (input === null && output === null) return null;
  const rate = pricing.rate_per_input_token_cached;
  const cacheRead =
    input !== null && rate !== null && rate !== undefined && rate > 0 && rate <= 1
      ? Number((input * rate).toPrecision(12))
      : null;
  const flexRate = pricing.rate_per_service_tier_flex;
  const flex =
    flexRate !== null && flexRate !== undefined && flexRate > 0 && flexRate < 1 ? flexRate : null;
  const extras = [
    ...(m.quantization ? [m.quantization] : []),
    ...(discount > 0 ? [`官方折扣 ${Math.round(discount * 100)}%`] : []),
    ...(flex !== null ? [`另有 Flex 档 ${flex}×，响应较慢`] : []),
  ];
  const quant = extras.length > 0 ? `（${extras.join("，")}）` : "";
  return {
    vendorHint,
    modelName: resellerModelName(m.model_name),
    platform: "deepinfra",
    currency: "USD",
    unit: "per_token",
    input,
    output,
    cacheRead,
    contextWindow: m.max_tokens ?? null,
    sourceUrl: `https://deepinfra.com/${m.model_name}`,
    notes: `DeepInfra 官方接口${quant}`,
  };
}

/** 模型列表 → 报价；同一模型重复出现时取输入价最低的一条 */
export function parseDeepinfra(data: unknown, now: Date): RawOffering[] {
  const list = z.array(z.unknown()).safeParse(data);
  if (!list.success)
    throw new PipelineError("E2001", "deepinfra：模型列表格式不对", { sourceId: SOURCE_ID });
  const nowSec = Math.floor(now.getTime() / 1000);
  const best = new Map<string, RawOffering>();
  for (const item of list.data) {
    const model = ModelSchema.safeParse(item);
    if (!model.success || !isActive(model.data, nowSec)) continue;
    const raw = toRaw(model.data, now);
    if (!raw) continue;
    const key = `${raw.vendorHint}|${raw.modelName.toLowerCase()}`;
    const current = best.get(key);
    if (!current || (raw.input ?? Infinity) < (current.input ?? Infinity)) best.set(key, raw);
  }
  return [...best.values()];
}

export const deepinfraSource: Source = {
  id: SOURCE_ID,
  platform: MULTI_PLATFORM,
  kind: "api",
  timeoutMs: 60_000,
  async fetch(ctx) {
    const data = await ctx.http.getJson(DEEPINFRA_URL, { timeoutMs: 30_000 });
    const offerings = parseDeepinfra(data, ctx.now);
    if (offerings.length === 0)
      throw new PipelineError("E2001", "deepinfra：没有解析出任何报价", { sourceId: SOURCE_ID });
    ctx.logger.info("deepinfra 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
