/**
 * Novita AI 官方模型列表（公开，无需 Key）：https://api.novita.ai/v3/openai/models
 * 直接取平台自己的价格，优先级高于 OpenRouter 服务商列表和 LiteLLM 社区价格表。
 * - 只收对话模型（model_type = chat）、状态正常、不分档计价的模型
 * - 价格取 pricing.*.price_per_m_decimal（美元 / 百万 tokens 的十进制字符串）
 * - 模型 ID 与 OpenRouter 写法一致（deepseek/deepseek-v4.1-flash-1017），由 reseller-model 识别厂商
 * 最后核对：2026-10-23
 */
import type { RawOffering } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "../core/errors";
import { inferVendorHint, resellerModelName } from "./reseller-model";
import { MULTI_PLATFORM, type Source } from "./types";

export const NOVITA_URL = "https://api.novita.ai/v3/openai/models";
const SOURCE_ID = "novita";
const NOVITA_PRICING_URL = "https://novita.ai/pricing";

const PriceSchema = z
  .object({ price_per_m_decimal: z.union([z.string(), z.number()]).nullable().optional() })
  .loose()
  .nullable()
  .optional();
const ModelSchema = z
  .object({
    id: z.string().min(1),
    display_name: z.string().nullable().optional(),
    model_type: z.string().nullable().optional(),
    status: z.number().nullable().optional(),
    is_tiered_billing: z.boolean().nullable().optional(),
    context_size: z.number().int().positive().nullable().optional(),
    max_output_tokens: z.number().int().positive().nullable().optional(),
    pricing: z
      .object({ prompt: PriceSchema, completion: PriceSchema, input_cache_read: PriceSchema })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();
type Model = z.infer<typeof ModelSchema>;
type Price = z.infer<typeof PriceSchema>;

function perMillion(price: Price): number | null {
  const value = price?.price_per_m_decimal;
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function toRaw(m: Model): RawOffering | null {
  if (m.model_type !== "chat" || m.status !== 1 || m.is_tiered_billing === true) return null;
  const vendorHint = inferVendorHint(m.id);
  if (vendorHint === null || !m.pricing) return null;
  const input = perMillion(m.pricing.prompt);
  const output = perMillion(m.pricing.completion);
  if (input === null && output === null) return null;
  const displayName = m.display_name?.trim();
  return {
    vendorHint,
    modelName: resellerModelName(m.id),
    ...(displayName ? { displayName } : {}),
    platform: "novita",
    currency: "USD",
    unit: "per_1m",
    input,
    output,
    cacheRead: perMillion(m.pricing.input_cache_read),
    contextWindow: m.context_size ?? null,
    maxOutput: m.max_output_tokens ?? null,
    sourceUrl: NOVITA_PRICING_URL,
    notes: "Novita AI 官方接口",
  };
}

export function parseNovita(data: unknown): RawOffering[] {
  const body = z.object({ data: z.array(z.unknown()) }).safeParse(data);
  if (!body.success)
    throw new PipelineError("E2001", "novita：模型列表格式不对", { sourceId: SOURCE_ID });
  const best = new Map<string, RawOffering>();
  for (const item of body.data.data) {
    const model = ModelSchema.safeParse(item);
    if (!model.success) continue;
    const raw = toRaw(model.data);
    if (!raw) continue;
    const key = `${raw.vendorHint}|${raw.modelName.toLowerCase()}`;
    const current = best.get(key);
    if (!current || (raw.input ?? Infinity) < (current.input ?? Infinity)) best.set(key, raw);
  }
  return [...best.values()];
}

export const novitaSource: Source = {
  id: SOURCE_ID,
  platform: MULTI_PLATFORM,
  kind: "api",
  timeoutMs: 60_000,
  async fetch(ctx) {
    const offerings = parseNovita(await ctx.http.getJson(NOVITA_URL, { timeoutMs: 30_000 }));
    if (offerings.length === 0)
      throw new PipelineError("E2001", "novita：没有解析出任何报价", { sourceId: SOURCE_ID });
    ctx.logger.info("novita 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
