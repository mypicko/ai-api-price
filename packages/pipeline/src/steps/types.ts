/**
 * 管线内部类型。对外的数据结构一律来自 @aipb/shared 的 schema。
 */
import type { MediaKind, MediaTier, MediaUnit, Offering, SourceKind, Warning } from "@aipb/shared";
import type { PipelineError } from "../core/errors";

/** 归一化后、校验前的报价：还没有发布相关的状态字段 */
export type Candidate = Omit<
  Offering,
  "isFree" | "stale" | "status" | "missingDays" | "firstSeenAt" | "fetchedAt" | "publishedAt"
>;

/**
 * 视频/图像报价在管线内部复用 Offering 的形状（input = 输入图价，output = 生成单价，
 * cacheRead / cacheWrite / tiers / contextWindow / maxOutput 恒为 null），
 * 这样隔离区、下架防抖、diff、history 可以原样复用；媒体特有字段放在 MediaExtras。
 */
export interface MediaExtras {
  readonly kind: MediaKind;
  readonly unit: MediaUnit;
  readonly mediaTiers: readonly MediaTier[] | null;
}
export type MediaCandidate = Candidate & MediaExtras;
export type LaneOffering = Offering & MediaExtras;

/** 一个源在「视频/图像」这条线上的结果；V5 与文本分开判断 */
export interface MediaLane {
  /** ok 或 rejected（V5）；源整体失败时不会有 media 字段 */
  readonly state: "ok" | "rejected";
  readonly candidates: readonly MediaCandidate[];
  readonly offeringCount: number;
  readonly invalidIds: readonly string[];
}

/**
 * 源在本次运行中的状态：
 * - ok：成功
 * - failed：抓取/解析失败，沿用旧数据并标记 stale
 * - rejected：V5 模型数骤降，整个源被拒绝，沿用旧数据并标记 stale
 * - skipped：本次没运行（--only / SOURCES_ENABLED），旧数据原样保留，不计失败
 */
export type SourceRunState = "ok" | "failed" | "rejected" | "skipped";

export interface SourceOutcome {
  readonly id: string;
  readonly kind: SourceKind;
  readonly platform: string;
  readonly state: SourceRunState;
  /** 只有 state = ok 时有内容 */
  readonly candidates: readonly Candidate[];
  /** 归一化后（V1/V2 之后）的条数，用于 V5 和 status.json */
  readonly offeringCount: number;
  /** 抓到了但被 V2 丢弃的 Offering ID：沿用旧值，不计入下架 */
  readonly invalidIds: readonly string[];
  readonly durationMs: number;
  readonly error: PipelineError | null;
  readonly warnings: readonly Warning[];
  /** 视频/图像报价；只有本次或上次产出过视频/图像的源才有 */
  readonly media?: MediaLane;
}

export function makeWarning(
  code: Warning["code"],
  message: string,
  refs: { readonly sourceId?: string | null; readonly offeringId?: string | null } = {},
): Warning {
  return { code, sourceId: refs.sourceId ?? null, offeringId: refs.offeringId ?? null, message };
}
