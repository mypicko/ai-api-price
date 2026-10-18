/**
 * OpenRouter 平台的视频生成报价（与文本报价一起由 openrouterSource 返回）。
 * 入口：https://openrouter.ai/api/v1/videos/models（公开，无需 Key）
 * pricing_skus 各家字段不统一，实测（2026-10-18）：
 * - cents_per_video_output_second_<分辨率> / cents_per_second_output[_<分辨率>]：美分/秒
 * - [text_to_video_|image_to_video_|reference_]duration_seconds[_with_audio|_without_audio][_<分辨率>]：美元/秒
 * - cents_per_second_video_continuation_<分辨率>：续写，美分/秒
 * - cents_per_image_input（美分/张）、reference_input_images / reference_images（美元/张）：输入参考图
 * - minimum_cents_per_generation：每次最低收费，写入 notes
 * - video_tokens*（按 token）、cents_per_megapixel_second_*（按百万像素·秒）无法换算成每秒，跳过并记 W2003
 * 没有不带前缀和分辨率的默认价时，默认价取最便宜的一档。
 */
import { roundSig, type MediaTier, type RawMediaOffering } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import { cleanDisplayName, parseModelId } from "./openrouter";

export const OPENROUTER_VIDEOS_URL = "https://openrouter.ai/api/v1/videos/models";

const RES = "(\\d+p|\\d+k)";
const QUALIFIERS: Readonly<Record<string, string>> = {
  text_to_video: "文生",
  image_to_video: "图生",
  reference: "参考",
  with_audio: "有声",
  without_audio: "无声",
};
const CENTS_OUTPUT = new RegExp(`^cents_per_(?:video_output_second|second_output)(?:_${RES})?$`);
const CENTS_CONTINUATION = new RegExp(`^cents_per_second_video_continuation(?:_${RES})?$`);
const USD_OUTPUT = new RegExp(
  `^(?:(text_to_video|image_to_video|reference)_)?duration_seconds(?:_(with_audio|without_audio))?(?:_${RES})?$`,
);
const USD_INPUT = /^(?:reference_input_images|reference_images)$/;

export type SkuRole = "output" | "input" | "minimum";

export interface ParsedSku {
  readonly role: SkuRole;
  /** 档位名，例如 "720p"、"有声 4k"；默认价为 "" */
  readonly label: string;
  readonly usd: number;
}

function label(...parts: readonly (string | undefined)[]): string {
  return parts
    .filter((p): p is string => p !== undefined)
    .map((p) => QUALIFIERS[p] ?? p)
    .join(" ");
}

function classify(key: string): { role: SkuRole; label: string; cents: boolean } | null {
  if (key === "minimum_cents_per_generation") return { role: "minimum", label: "", cents: true };
  if (key === "cents_per_image_input") return { role: "input", label: "", cents: true };
  if (USD_INPUT.test(key)) return { role: "input", label: "", cents: false };
  const cents = CENTS_OUTPUT.exec(key);
  if (cents) return { role: "output", label: label(cents[1]), cents: true };
  const continuation = CENTS_CONTINUATION.exec(key);
  if (continuation) return { role: "output", label: label("续写", continuation[1]), cents: true };
  const usd = USD_OUTPUT.exec(key);
  if (usd) return { role: "output", label: label(usd[1], usd[2], usd[3]), cents: false };
  return null;
}

/** 单个 SKU → 美元价格和档位；无法识别或价格非法时返回 null */
export function parseSku(key: string, value: unknown): ParsedSku | null {
  const kind = classify(key.toLowerCase());
  const amount = typeof value === "number" ? value : Number(value);
  if (!kind || value === "" || !Number.isFinite(amount) || amount < 0) return null;
  return { role: kind.role, label: kind.label, usd: roundSig(kind.cents ? amount / 100 : amount) };
}

const ModelSchema = z
  .object({
    id: z.string().regex(/^[^/\s]+\/[^\s]+$/),
    name: z.string().optional(),
    supported_frame_images: z.array(z.string()).nullable().optional(),
    pricing_skus: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .loose();
type VideoModel = z.infer<typeof ModelSchema>;

const ResponseSchema = z.object({ data: z.array(z.unknown()) });

function sortTiers(tiers: readonly MediaTier[]): MediaTier[] {
  const unique = [...new Map(tiers.map((t) => [t.label, t] as const)).values()];
  return unique.toSorted(
    (a, b) => (a.output ?? 0) - (b.output ?? 0) || a.label.localeCompare(b.label),
  );
}

interface SkuSplit {
  readonly parsed: readonly ParsedSku[];
  readonly unknown: readonly string[];
}

function splitSkus(model: VideoModel): SkuSplit {
  const entries = Object.entries(model.pricing_skus ?? {});
  const results = entries.map(([key, value]) => ({ key, sku: parseSku(key, value) }));
  return {
    parsed: results.flatMap((r) => (r.sku ? [r.sku] : [])),
    unknown: results.flatMap((r) => (r.sku ? [] : [r.key])),
  };
}

function toRaw(model: VideoModel, skus: readonly ParsedSku[]): RawMediaOffering | null {
  const outputs = skus.filter((s) => s.role === "output");
  const tiers = sortTiers(outputs.filter((s) => s.label !== "").map(toTier));
  const output = outputs.find((s) => s.label === "")?.usd ?? tiers[0]?.output ?? null;
  if (output === null) return null;
  const { vendor, model: name, baseId } = parseModelId(model.id);
  const displayName = cleanDisplayName(model.name);
  const minimum = skus.find((s) => s.role === "minimum");
  const raw: RawMediaOffering = {
    vendorHint: vendor,
    modelName: name,
    ...(displayName === undefined ? {} : { displayName }),
    currency: "USD",
    media: { kind: "video", unit: "per_second" },
    input: skus.find((s) => s.role === "input")?.usd ?? null,
    output,
    modalities: (model.supported_frame_images?.length ?? 0) > 0 ? ["text", "image"] : ["text"],
    sourceUrl: `https://openrouter.ai/${baseId}`,
    ...(minimum ? { notes: `每次生成最低 ${minimum.usd} USD` } : {}),
  };
  // 只有一档且等于默认价时没有意义，不输出
  const meaningful = tiers.length > 1 || (tiers[0] !== undefined && tiers[0].output !== output);
  return meaningful ? { ...raw, tiers } : raw;
}

function toTier(sku: ParsedSku): MediaTier {
  return { label: sku.label, output: sku.usd };
}

export interface OpenRouterVideosParseOptions {
  readonly isKnownVendor: (vendor: string) => boolean;
  readonly logger: Logger;
}

function parseModel(model: VideoModel, logger: Logger): RawMediaOffering | null {
  const { parsed, unknown } = splitSkus(model);
  const raw = toRaw(model, parsed);
  if (unknown.length > 0 || !raw) {
    logger.warn(
      raw ? "openrouter：跳过无法识别的视频 SKU" : "openrouter：视频模型的计价方式无法识别，已跳过",
      { sourceId: "openrouter", code: "W2003", model: model.id, skus: unknown },
    );
  }
  return raw;
}

export function parseOpenRouterVideos(
  data: unknown,
  options: OpenRouterVideosParseOptions,
): RawMediaOffering[] {
  const response = ResponseSchema.safeParse(data);
  if (!response.success)
    throw new PipelineError("E2001", "openrouter：视频接口响应缺少 data 数组", {
      sourceId: "openrouter",
    });
  return response.data.data.flatMap((item) => {
    const result = ModelSchema.safeParse(item);
    if (!result.success || !options.isKnownVendor(parseModelId(result.data.id).vendor)) return [];
    const raw = parseModel(result.data, options.logger);
    return raw ? [raw] : [];
  });
}
