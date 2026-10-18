/**
 * 并发执行数据源（Promise.allSettled 语义：单个源失败不影响其他源），
 * 然后对每个成功的源依次执行 S6 截断 → V1 → normalize → V2 → V5。
 * 视频/图像报价（带 media 字段）走同样的规则，单独计数（见 media-normalize.ts）。
 */
import type { AliasesConfig, Offering, ProvidersConfig, Warning } from "@aipb/shared";
import { PipelineError, toPipelineError } from "../core/errors";
import type { Source, SourceContext, SourceItem } from "../sources/types";
import { buildMediaLane, isRawMedia, type MediaLaneResult } from "./media-normalize";
import {
  createAliasResolver,
  createVendorMatcher,
  normalizeOfferings,
  sanitizeRaw,
  type NormalizeContext,
} from "./normalize";
import type { Candidate, SourceOutcome } from "./types";
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
  /** 上次已发布的视频/图像报价（内部形状），用于 V5 */
  readonly previousMedia?: readonly Offering[];
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

interface TextLane {
  readonly candidates: readonly Candidate[];
  readonly invalidIds: readonly string[];
  readonly offeringCount: number;
  readonly warnings: readonly Warning[];
  readonly drop: Warning | null;
}

function activeCount(previous: readonly Offering[] | undefined, sourceId: string): number {
  return (previous ?? []).filter((o) => o.source === sourceId && o.status !== "removed").length;
}

function processText(
  raws: readonly unknown[],
  input: RunSourcesInput,
  ctx: NormalizeContext,
): TextLane {
  const structure = checkStructure(raws, ctx.sourceId);
  const normalized = normalizeOfferings(structure.valid, ctx);
  const range = checkPriceRange(normalized.candidates, input.usdCny);
  const unknownWarning: Warning[] =
    normalized.unknownVendors.length === 0
      ? []
      : [
          makeWarning("W2003", `厂商无法识别，已跳过：${normalized.unknownVendors.join(", ")}`, {
            sourceId: ctx.sourceId,
          }),
        ];
  const offeringCount = range.valid.length;
  return {
    candidates: range.valid,
    invalidIds: range.invalidIds,
    offeringCount,
    warnings: [...structure.warnings, ...normalized.warnings, ...unknownWarning, ...range.warnings],
    drop: checkModelCountDrop(
      ctx.sourceId,
      offeringCount,
      activeCount(input.previous, ctx.sourceId),
    ),
  };
}

/** 本次和上次都没有视频/图像报价的源不建 media 线，避免把它的旧数据误判成下架 */
function processMedia(
  raws: readonly unknown[],
  input: RunSourcesInput,
  ctx: NormalizeContext,
): MediaLaneResult | null {
  const previousCount = activeCount(input.previousMedia, ctx.sourceId);
  if (raws.length === 0 && previousCount === 0) return null;
  return buildMediaLane({ raws, ctx, usdCny: input.usdCny, previousCount });
}

function processRaw(
  source: Source,
  raws: readonly SourceItem[],
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
  const ctx: NormalizeContext = {
    sourceId: source.id,
    platform,
    matchVendor: createVendorMatcher(input.providers),
    resolveAlias: createAliasResolver(input.aliases),
  };
  const sanitized = raws.map((r: unknown) => sanitizeRaw(r));
  const text = processText(
    sanitized.filter((r) => !isRawMedia(r)),
    input,
    ctx,
  );
  const media = processMedia(sanitized.filter(isRawMedia), input, ctx);
  const warnings = [...text.warnings, ...(media?.warnings ?? [])];
  const base = {
    ...baseOutcome(source),
    offeringCount: text.offeringCount,
    durationMs,
    error: null,
    ...(media ? { media: media.lane } : {}),
  };
  if (text.drop) return { ...base, state: "rejected", warnings: [...warnings, text.drop] };
  return {
    ...base,
    state: "ok",
    candidates: text.candidates,
    invalidIds: text.invalidIds,
    warnings,
  };
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
