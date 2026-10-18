/**
 * LiteLLM 价格表里的视频/图像生成模型（mode = video_generation / image_generation）。
 * 实测字段（2026-10-18）：
 * - 视频：output_cost_per_second（默认档）+ output_cost_per_second_<分辨率>（480p/720p/1080p/4k…）；
 *   个别条目用 output_cost_per_video_per_second；input_cost_per_image = 每张输入参考图
 * - 图像：output_cost_per_image（+ output_cost_per_image_<尺寸>）；OpenAI / xAI 的条目把单张生成价
 *   写在 input_cost_per_image，并用 "<quality>/<W>-x-<H>/<model>" 的键表示不同质量和尺寸
 * - 只按 token 计价的图像模型（gpt-image-1 等）没有按张价格，跳过
 * - 只收厂商直连；Runway 只收自研的 gen* / aleph*（其余是转售的第三方模型）
 */
import {
  roundSig,
  type MediaKind,
  type MediaTier,
  type MediaUnit,
  type RawMediaOffering,
} from "@aipb/shared";
import { z } from "zod";
import { LITELLM_URL, isDeprecated, type LitellmParseOptions } from "./litellm-shared";

/** litellm_provider → vendorHint（与 providers.yaml 的 matchers 对应） */
export const MEDIA_PROVIDERS: Readonly<Record<string, string>> = {
  openai: "openai",
  gemini: "gemini",
  xai: "xai",
  minimax: "minimax",
  dashscope: "alibaba",
  volcengine: "bytedance",
  black_forest_labs: "black-forest-labs",
  stability: "stability",
  recraft: "recraft",
  runwayml: "runway",
};

/** 平台上混有转售模型时，只收自研模型 */
const OWN_MODELS: Readonly<Record<string, RegExp>> = { runwayml: /^(gen|aleph)/i };

const MODES: Readonly<Record<string, { kind: MediaKind; unit: MediaUnit }>> = {
  video_generation: { kind: "video", unit: "per_second" },
  image_generation: { kind: "image", unit: "per_image" },
};

const QUALITIES: ReadonlySet<string> = new Set(["low", "medium", "high", "standard", "hd"]);
const SIZE = /^(\d+)-x-(\d+)$/;
const VIDEO_TIER = /^output_cost_per_second_(.+)$/;
const IMAGE_TIER = /^output_cost_per_image_(?!token)(.+)$/;

const Cost = z.number().nonnegative().finite();
const EntrySchema = z
  .object({
    litellm_provider: z.string(),
    mode: z.string(),
    output_cost_per_second: Cost.optional(),
    output_cost_per_video_per_second: Cost.optional(),
    output_cost_per_image: Cost.optional(),
    input_cost_per_image: Cost.optional(),
    supported_modalities: z.array(z.string()).optional(),
    deprecation_date: z.string().optional(),
    source: z.string().optional(),
  })
  .loose();
type Entry = z.infer<typeof EntrySchema>;

export interface LitellmMediaOptions extends LitellmParseOptions {
  /** 条目自带的 source 链接是否可以作为证据链接（域名白名单 S8） */
  readonly isAllowedUrl?: (vendorHint: string, url: string) => boolean;
}

/** 一个 LiteLLM 键解析出的模型名和质量/尺寸档位 */
export interface VariantKey {
  readonly modelName: string;
  /** "high 1024x1536"；不是变体时为 null */
  readonly variant: string | null;
}

/** "low/1024-x-1024/gpt-image-1" → { gpt-image-1, "low 1024x1024" }；"gemini/imagen-3" → { imagen-3, null } */
export function parseVariantKey(key: string): VariantKey {
  const segments = key.split("/");
  const modelName = segments.at(-1) ?? key;
  const labels = segments.slice(0, -1).flatMap((s) => {
    const size = SIZE.exec(s);
    if (size) return [`${size[1]}x${size[2]}`];
    return QUALITIES.has(s.toLowerCase()) ? [s.toLowerCase()] : [];
  });
  return { modelName, variant: labels.length === 0 ? null : labels.join(" ") };
}

/** 单条目的默认价和输入图价；没有按秒/按张价格时返回 null */
function basePrices(
  entry: Entry,
  kind: MediaKind,
): { output: number; input: number | null } | null {
  if (kind === "video") {
    const output = entry.output_cost_per_second ?? entry.output_cost_per_video_per_second;
    return output === undefined ? null : { output, input: entry.input_cost_per_image ?? null };
  }
  if (entry.output_cost_per_image !== undefined)
    return { output: entry.output_cost_per_image, input: entry.input_cost_per_image ?? null };
  // OpenAI / xAI 约定：input_cost_per_image 就是每张生成价
  return entry.input_cost_per_image === undefined
    ? null
    : { output: entry.input_cost_per_image, input: null };
}

/** output_cost_per_second_720p → { label: "720p" } */
export function entryTiers(entry: Entry, kind: MediaKind): readonly MediaTier[] {
  const pattern = kind === "video" ? VIDEO_TIER : IMAGE_TIER;
  return Object.entries(entry as Record<string, unknown>).flatMap(([key, value]) => {
    const label = pattern.exec(key)?.[1];
    return label && typeof value === "number" && Number.isFinite(value) && value >= 0
      ? [{ label: label.toLowerCase(), output: roundSig(value) }]
      : [];
  });
}

interface Group {
  readonly vendorHint: string;
  readonly provider: string;
  readonly modelName: string;
  readonly mode: { kind: MediaKind; unit: MediaUnit };
  readonly base: { output: number; input: number | null } | null;
  readonly tiers: readonly MediaTier[];
  readonly entry: Entry;
}

function sortTiers(tiers: readonly MediaTier[]): MediaTier[] {
  const unique = [...new Map(tiers.map((t) => [t.label, t] as const)).values()];
  return unique.toSorted(
    (a, b) => (a.output ?? 0) - (b.output ?? 0) || a.label.localeCompare(b.label),
  );
}

function evidenceUrl(group: Group, options: LitellmMediaOptions): string {
  const own = group.entry.source;
  if (own?.startsWith("https://") && options.isAllowedUrl?.(group.vendorHint, own)) return own;
  return options.pricingUrlFor(group.vendorHint) ?? LITELLM_URL;
}

function toRaw(group: Group, options: LitellmMediaOptions): RawMediaOffering | null {
  const tiers = sortTiers(group.tiers);
  const output = group.base?.output ?? tiers[0]?.output ?? null;
  if (output === null) return null;
  const input = group.base?.input ?? null;
  const raw: RawMediaOffering = {
    vendorHint: group.vendorHint,
    modelName: group.modelName,
    currency: "USD",
    media: group.mode,
    input: input === null ? null : roundSig(input),
    output: roundSig(output),
    modalities: group.entry.supported_modalities ?? ["text"],
    sourceUrl: evidenceUrl(group, options),
  };
  // 只有一档且等于默认价时没有意义，不输出
  const meaningful = tiers.length > 1 || (tiers[0] !== undefined && tiers[0].output !== raw.output);
  return meaningful ? { ...raw, tiers } : raw;
}

function accept(key: string, value: unknown, options: LitellmMediaOptions): Group | null {
  const parsed = EntrySchema.safeParse(value);
  if (!parsed.success) return null;
  const entry = parsed.data;
  const vendorHint = MEDIA_PROVIDERS[entry.litellm_provider];
  const mode = MODES[entry.mode];
  if (vendorHint === undefined || mode === undefined || isDeprecated(entry, options.today))
    return null;
  const { modelName, variant } = parseVariantKey(key);
  if (OWN_MODELS[entry.litellm_provider]?.test(modelName) === false) return null;
  const base = basePrices(entry, mode.kind);
  const tiers = entryTiers(entry, mode.kind);
  if (variant === null) {
    return { vendorHint, provider: entry.litellm_provider, modelName, mode, base, tiers, entry };
  }
  const variantTiers = base ? [{ label: variant, output: roundSig(base.output) }] : [];
  return {
    vendorHint,
    provider: entry.litellm_provider,
    modelName,
    mode,
    base: null,
    tiers: variantTiers,
    entry,
  };
}

/** 同一模型的基础条目和质量/尺寸变体合并成一条；基础条目优先提供默认价 */
function mergeGroups(a: Group, b: Group): Group {
  const primary = a.base ? a : b.base ? b : a;
  return { ...primary, tiers: [...a.tiers, ...b.tiers] };
}

export function parseLitellmMedia(
  data: Readonly<Record<string, unknown>>,
  options: LitellmMediaOptions,
): RawMediaOffering[] {
  const groups = new Map<string, Group>();
  for (const [key, value] of Object.entries(data)) {
    const group = accept(key, value, options);
    if (!group) continue;
    const id = `${group.vendorHint}|${group.mode.kind}|${group.modelName.toLowerCase()}`;
    const existing = groups.get(id);
    groups.set(id, existing ? mergeGroups(existing, group) : group);
  }
  return [...groups.values()].flatMap((g) => {
    const raw = toRaw(g, options);
    return raw ? [raw] : [];
  });
}
