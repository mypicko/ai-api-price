/**
 * 管线内部类型。对外的数据结构一律来自 @aipb/shared 的 schema。
 */
import type { Offering, SourceKind, Warning } from "@aipb/shared";
import type { PipelineError } from "../core/errors";

/** 归一化后、校验前的报价：还没有发布相关的状态字段 */
export type Candidate = Omit<
  Offering,
  "isFree" | "stale" | "status" | "missingDays" | "firstSeenAt" | "fetchedAt" | "publishedAt"
>;

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
}

export function makeWarning(
  code: Warning["code"],
  message: string,
  refs: { readonly sourceId?: string | null; readonly offeringId?: string | null } = {},
): Warning {
  return { code, sourceId: refs.sourceId ?? null, offeringId: refs.offeringId ?? null, message };
}
