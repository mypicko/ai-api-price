/**
 * 源健康度（DEV_DOCUMENT §3.6）：
 * - ok → lastSuccessAt = now，consecutiveFailures = 0
 * - failed / rejected → consecutiveFailures + 1；≥ STALE_ALERT_DAYS 时给出 E1005
 * - skipped（本次没运行）→ 沿用上次的记录，不计失败
 * 另含 manual 配置 verifiedAt 的新鲜度检查。
 */
import type { SourceResult, Warning } from "@aipb/shared";
import type { ManualConfigFile } from "../config-files";
import { daysBetween } from "./dates";
import type { SourceOutcome } from "./types";
import { makeWarning } from "./types";

export const MANUAL_MAX_AGE_DAYS = 14;
/** 暂未列入 errors.ts 的警告码：手动价格超过 14 天未核对 */
export const MANUAL_STALE_CODE = "W2004";

export interface SourceHealthInput {
  readonly outcomes: readonly SourceOutcome[];
  readonly previous: readonly SourceResult[];
  readonly nowIso: string;
  readonly staleAlertDays: number;
}

export interface SourceHealthResult {
  readonly results: readonly SourceResult[];
  readonly warnings: readonly Warning[];
}

function toResult(
  outcome: SourceOutcome,
  prev: SourceResult | undefined,
  nowIso: string,
): SourceResult {
  const isOk = outcome.state === "ok";
  const errorCode = outcome.state === "rejected" ? "E3004" : (outcome.error?.code ?? null);
  return {
    id: outcome.id,
    kind: outcome.kind,
    status: outcome.state === "rejected" ? "rejected" : isOk ? "ok" : "failed",
    offeringCount: outcome.offeringCount,
    durationMs: Math.max(0, Math.round(outcome.durationMs)),
    errorCode: isOk ? null : errorCode,
    errorMessage: isOk
      ? null
      : (outcome.error?.message ??
        (outcome.state === "rejected" ? "模型数骤降，整个源被拒绝" : null)),
    lastSuccessAt: isOk ? nowIso : (prev?.lastSuccessAt ?? null),
    consecutiveFailures: isOk ? 0 : (prev?.consecutiveFailures ?? 0) + 1,
  };
}

export function buildSourceResults(input: SourceHealthInput): SourceHealthResult {
  const prevById = new Map(input.previous.map((r) => [r.id, r] as const));
  const ran = input.outcomes.filter((o) => o.state !== "skipped");
  const ranIds = new Set(ran.map((o) => o.id));
  const fresh = ran.map((o) => toResult(o, prevById.get(o.id), input.nowIso));
  const kept = input.previous.filter((r) => !ranIds.has(r.id));
  const results = [...fresh, ...kept].toSorted((a, b) => a.id.localeCompare(b.id));
  const warnings = fresh
    .filter((r) => r.consecutiveFailures >= input.staleAlertDays)
    .map((r) =>
      makeWarning(
        "E1005",
        `数据源连续失败 ${r.consecutiveFailures} 次（上次成功：${r.lastSuccessAt ?? "从未"}）`,
        {
          sourceId: r.id,
        },
      ),
    );
  return { results, warnings };
}

export function checkManualFreshness(
  files: readonly ManualConfigFile[],
  now: Date,
): readonly Warning[] {
  return files.flatMap((f) => {
    const age = daysBetween(`${f.config.verifiedAt}T00:00:00+08:00`, now);
    if (age <= MANUAL_MAX_AGE_DAYS) return [];
    const message = `手动价格 ${f.file} 已 ${age} 天未核对（verifiedAt = ${f.config.verifiedAt}）`;
    return [makeWarning(MANUAL_STALE_CODE, message, { sourceId: "manual" })];
  });
}
