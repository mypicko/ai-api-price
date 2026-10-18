/**
 * OpenRouter 平台的视频生成报价（与文本报价一起由 openrouterSource 返回）。
 * 入口：https://openrouter.ai/api/v1/videos/models（公开，无需 Key）
 * pricing_skus 各家字段不统一，实测（2026-10-18）：
 * - cents_per_video_output_second_<分辨率> / cents_per_second_output[_<分辨率>]：美分/秒
 * - [text_to_video_|image_to_video_|reference_]duration_seconds[_with_audio|_without_audio][_<分辨率>]：美元/秒
 * - cents_per_second_video_continuation_<分辨率>：续写，美分/秒
 * - cents_per_image_input（美分/张）、reference_input_images / reference_images（美元/张）：输入参考图
 * - minimum_cents_per_generation：每次最低收费，写入 notes
 * - video_tokens[_<分辨率>][_without_audio]（Seedance，美元/token）：按 BytePlus ModelArk 的公式
 *   tokens = 宽 × 高 × 帧率 × 秒数 / 1024，取 16:9 标准尺寸、24fps 换算成美元/秒，每个 supported_resolutions
 *   一档；无声价不同时另加「无声 <分辨率>」档；*_with_video_input（含视频输入）不收，notes 注明换算前提
 * - cents_per_megapixel_second_*（按百万像素·秒）以及分辨率无法换算的 video_tokens：跳过并记 W2003
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
const TOKEN_SKU = /^video_tokens/;

/** video_tokens 换算：16:9 标准尺寸（BytePlus ModelArk 计费示例所用）、24fps、每 1024 像素·帧 1 token */
const TOKEN_FPS = 24;
const PIXELS_PER_TOKEN = 1024;
const FRAME_SIZES: Readonly<Record<string, readonly [number, number]>> = {
  "480p": [854, 480],
  "720p": [1280, 720],
  "1080p": [1920, 1080],
  "4k": [3840, 2160],
};
export const TOKEN_NOTE =
  "按 token 计价换算：16:9 标准尺寸、24fps；其他画幅按像素数增减，含视频输入另计";

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

/** 每秒视频的 token 数；没有标准尺寸的分辨率（如 768p、2k）返回 null */
export function videoTokensPerSecond(resolution: string): number | null {
  const size = FRAME_SIZES[resolution.toLowerCase()];
  return size ? (size[0] * size[1] * TOKEN_FPS) / PIXELS_PER_TOKEN : null;
}

function tokenRate(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return value === undefined || value === "" || !Number.isFinite(amount) || amount < 0
    ? null
    : amount;
}

/** 一个分辨率的有声价和无声价（美元/秒）；分辨率自己的单价优先于通用单价 */
function tokenTiersAt(resolution: string, skus: Readonly<Record<string, unknown>>): ParsedSku[] {
  const perSecond = videoTokensPerSecond(resolution);
  if (perSecond === null) return [];
  const own = tokenRate(skus[`video_tokens_${resolution}`]);
  const voiced = own ?? tokenRate(skus["video_tokens"]);
  const silent =
    tokenRate(skus[`video_tokens_${resolution}_without_audio`]) ??
    (own === null ? tokenRate(skus["video_tokens_without_audio"]) : null);
  const tier = (label: string, rate: number): ParsedSku => ({
    role: "output",
    label,
    usd: roundSig(rate * perSecond),
  });
  return [
    ...(voiced === null ? [] : [tier(resolution, voiced)]),
    ...(silent === null || silent === voiced ? [] : [tier(`无声 ${resolution}`, silent)]),
  ];
}

const ModelSchema = z
  .object({
    id: z.string().regex(/^[^/\s]+\/[^\s]+$/),
    name: z.string().optional(),
    supported_resolutions: z.array(z.string()).nullable().optional(),
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
  /** 是否有按 token 换算出的档位（需要在 notes 里注明换算前提） */
  readonly tokenPriced: boolean;
}

function splitTokenSkus(model: VideoModel, skus: Readonly<Record<string, unknown>>): SkuSplit {
  const keys = Object.keys(skus).filter((k) => TOKEN_SKU.test(k));
  if (keys.length === 0) return { parsed: [], unknown: [], tokenPriced: false };
  const resolutions = (model.supported_resolutions ?? []).map((r) => r.toLowerCase());
  const parsed = resolutions.flatMap((r) => tokenTiersAt(r, skus));
  return parsed.length === 0
    ? { parsed: [], unknown: keys, tokenPriced: false }
    : { parsed, unknown: [], tokenPriced: true };
}

function splitSkus(model: VideoModel): SkuSplit {
  const skus = Object.fromEntries(
    Object.entries(model.pricing_skus ?? {}).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  const results = Object.entries(skus)
    .filter(([key]) => !TOKEN_SKU.test(key))
    .map(([key, value]) => ({ key, sku: parseSku(key, value) }));
  const tokens = splitTokenSkus(model, skus);
  return {
    parsed: [...results.flatMap((r) => (r.sku ? [r.sku] : [])), ...tokens.parsed],
    unknown: [...results.flatMap((r) => (r.sku ? [] : [r.key])), ...tokens.unknown],
    tokenPriced: tokens.tokenPriced,
  };
}

function buildNotes(skus: readonly ParsedSku[], tokenPriced: boolean): string | null {
  const minimum = skus.find((s) => s.role === "minimum");
  const parts = [
    ...(minimum ? [`每次生成最低 ${minimum.usd} USD`] : []),
    ...(tokenPriced ? [TOKEN_NOTE] : []),
  ];
  return parts.length === 0 ? null : parts.join("；");
}

function toRaw(model: VideoModel, split: SkuSplit): RawMediaOffering | null {
  const skus = split.parsed;
  const outputs = skus.filter((s) => s.role === "output");
  const tiers = sortTiers(outputs.filter((s) => s.label !== "").map(toTier));
  const output = outputs.find((s) => s.label === "")?.usd ?? tiers[0]?.output ?? null;
  if (output === null) return null;
  const { vendor, model: name, baseId } = parseModelId(model.id);
  const displayName = cleanDisplayName(model.name);
  const notes = buildNotes(skus, split.tokenPriced);
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
    ...(notes === null ? {} : { notes }),
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
  const split = splitSkus(model);
  const { unknown } = split;
  const raw = toRaw(model, split);
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
