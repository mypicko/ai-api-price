/**
 * 并发执行数据源（Promise.allSettled 语义：单个源失败不影响其他源），
 * 然后对每个成功的源依次执行 S6 截断 → V1 → normalize → V2 → V5。
 */
import type { AliasesConfig, Offering, ProvidersConfig, RawOffering, Warning } from "@aipb/shared";
import { PipelineError, toPipelineError } from "../core/errors";
import type { Source, SourceContext } from "../sources/types";
import {
  createAliasResolver,
  createVendorMatcher,
  normalizeOfferings,
  sanitizeRaw,
} from "./normalize";
import type { SourceOutcome } from "./types";
import { makeWarning } from "./types";
import { checkModelCountDrop, checkPriceRange, checkStructure } from "./validate";

export interface RunSourcesInput {
  readonly sources: readonly Source[];
  /** null = 全部运行 */
  readonly selected: ReadonlySet<string> | null;
  readonly ctx: SourceContext;
  readonly providers: ProvidersConfig;
  readonly aliases: AliasesConfig;
  readonly usdCny: number;
  readonly previous: readonly Offering[];
  /** 毫秒时钟，用于计算耗时 */
  readonly clock: () => number;
}

export async function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  sourceId: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new PipelineError("E1002", `${sourceId} 抓取超时（${timeoutMs}ms）`, { sourceId })),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function baseOutcome(source: Source): Omit<SourceOutcome, "state" | "durationMs" | "error"> {
  return {
    id: source.id,
    kind: source.kind,
    platform: source.platform,
    candidates: [],
    offeringCount: 0,
    invalidIds: [],
    warnings: [],
  };
}

function skippedOutcome(source: Source): SourceOutcome {
  return { ...baseOutcome(source), state: "skipped", durationMs: 0, error: null };
}

function failedOutcome(source: Source, error: unknown, durationMs: number): SourceOutcome {
  const err = toPipelineError(error, "E2001", source.id);
  const warning = makeWarning(err.code, err.message, { sourceId: source.id });
  return { ...baseOutcome(source), state: "failed", durationMs, error: err, warnings: [warning] };
}

function processRaw(
  source: Source,
  raws: readonly RawOffering[],
  input: RunSourcesInput,
  durationMs: number,
): SourceOutcome {
  const platform = input.providers.platforms.find((p) => p.id === source.platform);
  if (!platform) {
    return failedOutcome(
      source,
      new PipelineError("E3001", `providers.yaml 中没有平台 ${source.platform}`),
      durationMs,
    );
  }
  const sanitized = raws.map((r: unknown) => sanitizeRaw(r));
  const structure = checkStructure(sanitized, source.id);
  const normalized = normalizeOfferings(structure.valid, {
    sourceId: source.id,
    platform,
    matchVendor: createVendorMatcher(input.providers),
    resolveAlias: createAliasResolver(input.aliases),
  });
  const range = checkPriceRange(normalized.candidates, input.usdCny);
  const unknownWarning: Warning[] =
    normalized.unknownVendors.length === 0
      ? []
      : [
          makeWarning("W2003", `厂商无法识别，已跳过：${normalized.unknownVendors.join(", ")}`, {
            sourceId: source.id,
          }),
        ];
  const warnings = [
    ...structure.warnings,
    ...normalized.warnings,
    ...unknownWarning,
    ...range.warnings,
  ];
  const previousCount = input.previous.filter(
    (o) => o.source === source.id && o.status !== "removed",
  ).length;
  const offeringCount = range.valid.length;
  const drop = checkModelCountDrop(source.id, offeringCount, previousCount);
  const base = { ...baseOutcome(source), offeringCount, durationMs, error: null };
  if (drop) return { ...base, state: "rejected", warnings: [...warnings, drop] };
  return { ...base, state: "ok", candidates: range.valid, invalidIds: range.invalidIds, warnings };
}

async function runOne(source: Source, input: RunSourcesInput): Promise<SourceOutcome> {
  if (input.selected !== null && !input.selected.has(source.id)) return skippedOutcome(source);
  const startedAt = input.clock();
  const logger = input.ctx.logger.child({ sourceId: source.id });
  try {
    const raws = await withTimeout(
      source.fetch({ ...input.ctx, logger }),
      source.timeoutMs,
      source.id,
    );
    const outcome = processRaw(source, raws, input, input.clock() - startedAt);
    logger.info("数据源完成", {
      state: outcome.state,
      count: outcome.offeringCount,
      durationMs: outcome.durationMs,
    });
    return outcome;
  } catch (error) {
    const outcome = failedOutcome(source, error, input.clock() - startedAt);
    logger.error("数据源失败", { code: outcome.error?.code, error: outcome.error?.message });
    return outcome;
  }
}

export async function runSources(input: RunSourcesInput): Promise<readonly SourceOutcome[]> {
  return Promise.all(input.sources.map((source) => runOne(source, input)));
}
