/**
 * 硅基流动（SiliconFlow）平台报价（聚合平台，platform = siliconflow；静态 HTML，Framer 站点服务端渲染）。
 * 入口：https://www.siliconflow.com/models
 *   中国站 siliconflow.cn 在 2026-10-18 实测境外网络无法连接；cloud.siliconflow.com 有 Cloudflare 拦截（不对抗）。
 *   国际站以美元标价，所以 currency = USD。
 * 结构要点：
 * - 每个模型一张卡片，字段用 data-framer-name 语义锚点：model_name、parameters（研发厂商名）、sub_type（chat / text-to-image …）、
 *   context_length、max_output_tokens，价格区是「Input: $ 0.15 / M Tokens  Cached Input: … Output: …」
 * - 只保留 sub_type = chat 的文本对话模型
 * - vendorHint 用研发厂商（映射到 providers.yaml 的 matchers），modelName 用卡片上的模型名（例如 DeepSeek-V4.1-Flash）
 * 最后核对：2026-10-18
 */
import type { RawOffering } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  type HtmlElement,
  normalizeSpace,
  parseTokenCount,
  resolvePrice,
  type ResolvedPrice,
  uniqueBy,
} from "./parse-price";
import type { Source } from "./types";

export const SILICONFLOW_URL = "https://www.siliconflow.com/models";
const SOURCE_ID = "siliconflow";

/** 卡片上的厂商显示名 → vendorHint（与 providers.yaml matchers 对齐；未知的原样小写返回，由 normalize 丢弃） */
const VENDOR_HINTS: Readonly<Record<string, string>> = {
  deepseek: "deepseek-ai",
  qwen: "Qwen",
  "z.ai": "zai",
  zhipu: "zhipuai",
  "moonshot ai": "moonshotai",
  minimaxai: "minimax",
  minimax: "minimax",
  tencent: "tencent",
  google: "google",
  openai: "openai",
  bytedance: "ByteDance-Seed",
  baidu: "baidu",
  "meta-llama": "meta-llama",
  meta: "meta-llama",
  stepfun: "stepfun-ai",
  longcat: "meituan-longcat",
};

export function toVendorHint(provider: string): string {
  const key = normalizeSpace(provider).toLowerCase();
  return VENDOR_HINTS[key] ?? key.replace(/\s+/g, "-");
}

type Label = "Cached Input" | "Input" | "Output";

/** "Input: $0.834 / M Tokens Cached Input: $0.042 / M Tokens Output: …" → 每个标签后面的价格文字 */
export function splitPriceText(text: string): Partial<Record<Label, string>> {
  const pattern = /(Cached Input|Input|Output)\s*:\s*(.*?)(?=(?:Cached Input|Input|Output)\s*:|$)/g;
  return Object.fromEntries(
    [...text.matchAll(pattern)].map((m) => [m[1], normalizeSpace(m[2] ?? "")]),
  );
}

function cardOf($: cheerio.CheerioAPI, nameEl: HtmlElement): cheerio.Cheerio<HtmlElement> {
  let card = $(nameEl);
  while (
    card.parent().length > 0 &&
    card.parent().find('[data-framer-name="model_name"]').length === 1
  )
    card = card.parent();
  return card;
}

function field(card: cheerio.Cheerio<HtmlElement>, name: string): string {
  return normalizeSpace(card.find(`[data-framer-name="${name}"]`).first().text());
}

function priceOf(parts: Partial<Record<Label, string>>, label: Label): ResolvedPrice | null {
  const text = parts[label];
  return text === undefined ? null : resolvePrice(text, { sourceId: SOURCE_ID });
}

function toOffering($: cheerio.CheerioAPI, nameEl: HtmlElement): RawOffering | null {
  const card = cardOf($, nameEl);
  if (field(card, "sub_type") !== "chat") return null;
  const modelName = normalizeSpace($(nameEl).text());
  // 去掉描述文字，避免描述里出现 "Output:" 之类的词干扰
  const priceText = card.clone().find('[data-framer-name="description"]').remove().end().text();
  const parts = splitPriceText(normalizeSpace(priceText));
  const input = priceOf(parts, "Input");
  const output = priceOf(parts, "Output");
  const reference = input ?? output;
  if (modelName === "" || !reference) return null;
  return {
    vendorHint: toVendorHint(field(card, "parameters")),
    modelName,
    currency: reference.currency,
    unit: reference.unit,
    input: input?.value ?? null,
    output: output?.value ?? null,
    cacheRead: priceOf(parts, "Cached Input")?.value ?? null,
    contextWindow: parseTokenCount(field(card, "context_length")),
    maxOutput: parseTokenCount(field(card, "max_output_tokens")),
    sourceUrl: SILICONFLOW_URL,
  };
}

export function parseSiliconflowHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  const offerings = $('[data-framer-name="model_name"]')
    .toArray()
    .flatMap((el) => {
      try {
        const offering = toOffering($, el);
        return offering ? [offering] : [];
      } catch (error) {
        logger?.warn("siliconflow：跳过无法识别的模型卡片", {
          sourceId: SOURCE_ID,
          code: "W2003",
          model: $(el).text(),
          error,
        });
        return [];
      }
    });
  const unique = uniqueBy(offerings, (o) => `${o.vendorHint}/${o.modelName}`);
  if (unique.length === 0)
    throw new PipelineError(
      "E2001",
      "siliconflow：找不到 chat 模型卡片（data-framer-name=model_name）",
      { sourceId: SOURCE_ID },
    );
  return unique;
}

export const siliconflowSource: Source = {
  id: SOURCE_ID,
  platform: "siliconflow",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(SILICONFLOW_URL, { timeoutMs: 30_000 });
    const offerings = parseSiliconflowHtml(html, ctx.logger);
    ctx.logger.info("siliconflow 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
