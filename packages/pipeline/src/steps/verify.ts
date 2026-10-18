/**
 * 接口源复核（DEV_DOCUMENT §3.5 V3a）：接口类数据源（kind = api）出现价格突变时，
 * 在同一次运行里重新请求一次接口；两次数值一致就视为已确认，直接发布，不进隔离区。
 * 网页抓取的源不复核，仍走「连续 2 次同一新值」的原隔离规则——重新抓同一个页面
 * 解析错误也会原样重现，复核没有意义。
 *
 * 文本和视频/图像两条线共用一次复核：同一个源只重新请求一次。
 */
import { priceSetEquals, type Offering, type Override, type Warning } from "@aipb/shared";
import type { Logger } from "../core/logger";
import { changedPriceFields, isAnomalous, pickPrices } from "./quarantine";
import { makeWarning, type Candidate, type SourceOutcome } from "./types";

/** 需要复核的报价（按源分组前的扁平列表） */
export interface Suspect {
  readonly sourceId: string;
  readonly candidate: Candidate;
}

export interface SuspectInput {
  readonly outcomes: readonly SourceOutcome[];
  /** 两条线上次已发布的报价（含 removed），ID 不会冲突 */
  readonly previous: readonly Offering[];
  readonly overrides: ReadonlyMap<string, Override>;
  readonly threshold: number;
}

function laneCandidates(outcome: SourceOutcome): readonly Candidate[] {
  const media = outcome.media?.state === "ok" ? outcome.media.candidates : [];
  return [...outcome.candidates, ...media];
}

function isSuspect(c: Candidate, prev: Offering | undefined, input: SuspectInput): boolean {
  if (!prev || prev.status === "removed" || prev.currency !== c.currency) return false;
  if (input.overrides.has(c.id)) return false;
  return isAnomalous(changedPriceFields(pickPrices(prev), pickPrices(c)), input.threshold);
}

/** 接口类、本次成功的源里，相对已发布值突变、且没有人工覆盖的报价 */
export function findSuspects(input: SuspectInput): readonly Suspect[] {
  const previous = new Map(input.previous.map((o) => [o.id, o] as const));
  return input.outcomes
    .filter((o) => o.kind === "api" && o.state === "ok")
    .flatMap((o) =>
      laneCandidates(o)
        .filter((c) => isSuspect(c, previous.get(c.id), input))
        .map((candidate) => ({ sourceId: o.id, candidate })),
    );
}

/** 复核结果里与第一次抓取完全一致的报价 ID；复核失败或没抓到的不算 */
export function matchRefetched(
  suspects: readonly Suspect[],
  refetched: readonly SourceOutcome[],
): ReadonlySet<string> {
  const again = new Map(
    refetched
      .filter((o) => o.state === "ok")
      .flatMap((o) => laneCandidates(o).map((c) => [`${o.id}|${c.id}`, c] as const)),
  );
  return new Set(
    suspects
      .filter(({ sourceId, candidate }) => {
        const second = again.get(`${sourceId}|${candidate.id}`);
        return second !== undefined && priceSetEquals(pickPrices(second), pickPrices(candidate));
      })
      .map((s) => s.candidate.id),
  );
}

export interface VerifyInput extends SuspectInput {
  /** 重新运行指定的源（同 runSources，只跑这些） */
  readonly rerun: (sourceIds: ReadonlySet<string>) => Promise<readonly SourceOutcome[]>;
  readonly logger: Logger;
}

export interface VerifyResult {
  /** 复核一致、可直接发布的报价 ID */
  readonly verified: ReadonlySet<string>;
  readonly warnings: readonly Warning[];
}

export async function verifyApiAnomalies(input: VerifyInput): Promise<VerifyResult> {
  const suspects = findSuspects(input);
  if (suspects.length === 0) return { verified: new Set(), warnings: [] };
  const sourceIds = new Set(suspects.map((s) => s.sourceId));
  input.logger.info("接口复核：重新请求突变价格所在的源", {
    sources: [...sourceIds],
    count: suspects.length,
  });
  const verified = matchRefetched(suspects, await input.rerun(sourceIds));
  const warnings = suspects
    .filter((s) => verified.has(s.candidate.id))
    .map((s) =>
      makeWarning("W3008", `接口复核一致，突变价格已直接发布：${s.candidate.displayName}`, {
        sourceId: s.sourceId,
        offeringId: s.candidate.id,
      }),
    );
  input.logger.info("接口复核完成", { checked: suspects.length, verified: verified.size });
  return { verified, warnings };
}
