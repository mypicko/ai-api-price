/**
 * 视频/图像报价的 S6 → V1 → normalize → V2 → V5（与文本报价相同的规则，分开计数）。
 * 价格不做单位换算：抓取器给出的就是每秒 / 每张的原币种价格。
 */
import {
  RawMediaOfferingSchema,
  type RawMediaOffering,
  type RawOffering,
  type Warning,
} from "@aipb/shared";
import { normalizeOne, type NormalizeContext } from "./normalize";
import type { Candidate, MediaCandidate, MediaLane } from "./types";
import { makeWarning } from "./types";
import {
  checkModelCountDrop,
  checkPriceRange,
  checkStructure,
  MEDIA_PRICE_LIMIT,
} from "./validate";

const LANE_LABEL = "视频/图像";

/** 抓取器输出里带 media 对象的条目是视频/图像报价 */
export function isRawMedia(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("media" in raw)) return false;
  return typeof raw.media === "object" && raw.media !== null;
}

/** 借用文本的 normalizeOne（厂商匹配、别名、S8）；per_1m 的倍数是 1，价格保持原值 */
function asTokenShape(raw: RawMediaOffering): RawOffering {
  return {
    vendorHint: raw.vendorHint,
    modelName: raw.modelName,
    ...(raw.displayName === undefined ? {} : { displayName: raw.displayName }),
    currency: raw.currency,
    unit: "per_1m",
    input: raw.input,
    output: raw.output,
    ...(raw.modalities === undefined ? {} : { modalities: raw.modalities }),
    sourceUrl: raw.sourceUrl,
    ...(raw.notes === undefined ? {} : { notes: raw.notes }),
  };
}

function toMediaCandidate(raw: RawMediaOffering, candidate: Candidate): MediaCandidate {
  const tiers = (raw.tiers ?? []).toSorted(
    (a, b) => (a.output ?? 0) - (b.output ?? 0) || a.label.localeCompare(b.label),
  );
  return {
    ...candidate,
    cacheRead: null,
    cacheWrite: null,
    tiers: null,
    contextWindow: null,
    maxOutput: null,
    kind: raw.media.kind,
    unit: raw.media.unit,
    mediaTiers: tiers.length === 0 ? null : tiers,
  };
}

export interface MediaNormalizeResult {
  readonly candidates: readonly MediaCandidate[];
  readonly warnings: readonly Warning[];
  readonly unknownVendors: readonly string[];
}

/** 同一源内重复的 Offering ID 只保留第一条 */
export function normalizeMediaOfferings(
  raws: readonly RawMediaOffering[],
  ctx: NormalizeContext,
): MediaNormalizeResult {
  const results = raws.map((raw) => ({ raw, result: normalizeOne(asTokenShape(raw), ctx) }));
  const seen = new Set<string>();
  const candidates = results
    .flatMap(({ raw, result }) =>
      result.kind === "ok" ? [toMediaCandidate(raw, result.candidate)] : [],
    )
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  const warnings = results.flatMap(({ result }) =>
    result.kind === "invalid" ? [result.warning] : [],
  );
  const unknownVendors = [
    ...new Set(
      results.flatMap(({ result }) => (result.kind === "unknown-vendor" ? [result.hint] : [])),
    ),
  ].toSorted();
  return { candidates, warnings, unknownVendors };
}

export interface MediaLaneInput {
  readonly raws: readonly unknown[];
  readonly ctx: NormalizeContext;
  readonly usdCny: number;
  /** 上次该源已发布且未下架的视频/图像报价条数 */
  readonly previousCount: number;
}

export interface MediaLaneResult {
  readonly lane: MediaLane;
  readonly warnings: readonly Warning[];
}

export function buildMediaLane(input: MediaLaneInput): MediaLaneResult {
  const { sourceId } = input.ctx;
  const structure = checkStructure(input.raws, sourceId, RawMediaOfferingSchema);
  const normalized = normalizeMediaOfferings(structure.valid, input.ctx);
  const range = checkPriceRange(normalized.candidates, input.usdCny, MEDIA_PRICE_LIMIT);
  const unknown: Warning[] =
    normalized.unknownVendors.length === 0
      ? []
      : [
          makeWarning(
            "W2003",
            `${LANE_LABEL}厂商无法识别，已跳过：${normalized.unknownVendors.join(", ")}`,
            { sourceId },
          ),
        ];
  const warnings = [...structure.warnings, ...normalized.warnings, ...unknown, ...range.warnings];
  const offeringCount = range.valid.length;
  const drop = checkModelCountDrop(
    sourceId,
    offeringCount,
    input.previousCount,
    `${LANE_LABEL}模型数骤降`,
    `该源的${LANE_LABEL}报价`,
  );
  if (drop) {
    const lane: MediaLane = { state: "rejected", candidates: [], offeringCount, invalidIds: [] };
    return { lane, warnings: [...warnings, drop] };
  }
  const lane: MediaLane = {
    state: "ok",
    candidates: range.valid,
    offeringCount,
    invalidIds: range.invalidIds,
  };
  return { lane, warnings };
}
