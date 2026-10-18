/**
 * 管线编排（DEV_DOCUMENT §5.1、§6.1）：
 *   读旧数据 → 汇率 → 并发抓取 → normalize/V1/V2/V5 → reconcile(V3/V4/V6/V8) → V7
 *   → diff → history → 写 data/（原子替换）→ 推送 → job summary
 * 视频/图像报价走同一套步骤，结果写在 data/media/（见 media-lane.ts）。
 * 退出码（§9.1）：全部成功 / 部分失败 = 0，全部失败 = 1；E4001 由调用方以 1 退出。
 */
import { appendFile } from "node:fs/promises";
import type { ChangeEvent, MediaOffering, Offering, StatusFile, Warning } from "@aipb/shared";
import type { AppConfig } from "../config";
import { loadConfigFiles } from "../config-files";
import type { BrowserClient } from "../core/browser";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";
import { resolveFx, type ResolveFxResult } from "../fx/fx";
import { sendReport, shouldNotify, type Notifier } from "../notify";
import type { Source } from "../sources/types";
import {
  buildLatestFile,
  isLatestUnchanged,
  mergeMonthEvents,
  planOutputFiles,
  sortWarnings,
} from "./build-output";
import { crossCheck } from "./cross-check";
import { monthOf, shanghaiDate, toIsoSeconds } from "./dates";
import { diffOfferings } from "./diff";
import { verifyApiAnomalies, type VerifyResult } from "./verify";
import { harmonizeDisplayNames, unifyDisplayNames } from "./display-names";
import { enrichMetadata, resolveMetadata, type ModelMetadata } from "./metadata";
import { createAliasResolver, createVendorMatcher } from "./normalize";
import { fetchModelsDevMetadata } from "../sources/modelsdev";
import {
  analyzeMedia,
  loadPreviousMediaState,
  reconcileMedia,
  toLaneOffering,
  type MediaAnalyzed,
  type PreviousMediaState,
} from "./media-lane";
import { planHistoryUpdates } from "./history";
import { persistFiles, type PlannedFile } from "./persist";
import { reconcile, type ReconcileResult } from "./reconcile";
import { buildDailyReport, buildSummaryMarkdown } from "./report";
import { runSources } from "./fetch-sources";
import { buildSourceResults, checkManualFreshness } from "./source-health";
import { loadChangesMonth, loadHistoryFiles, loadPreviousState, type PreviousState } from "./state";
import type { SourceOutcome } from "./types";
import { activeOverrides } from "./validate";

export interface RunOptions {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly sources: readonly Source[];
  /** null = 全部运行 */
  readonly selected: ReadonlySet<string> | null;
  readonly config: AppConfig;
  readonly configWarnings: readonly Warning[];
  readonly http: HttpClient;
  readonly browser: BrowserClient;
  readonly logger: Logger;
  readonly clock: () => Date;
  readonly dryRun: boolean;
  readonly notify: boolean;
  readonly notifiers: readonly Notifier[];
}

export interface RunResult {
  readonly exitCode: 0 | 1;
  readonly status: StatusFile;
  readonly events: readonly ChangeEvent[];
  readonly offerings: readonly Offering[];
  readonly mediaOfferings: readonly MediaOffering[];
  readonly mediaEvents: readonly ChangeEvent[];
  readonly written: readonly string[];
  readonly latestUnchanged: boolean;
  readonly summary: string;
}

function runResult(outcomes: readonly SourceOutcome[]): StatusFile["run"]["result"] {
  const ran = outcomes.filter((o) => o.state !== "skipped");
  const ok = ran.filter((o) => o.state === "ok").length;
  if (ok === 0) return "failed";
  return ok === ran.length ? "success" : "partial";
}

function localRunId(now: Date): string {
  return `local-${now
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14)}`;
}

interface Gathered {
  readonly startedAt: Date;
  readonly nowIso: string;
  readonly today: string;
  readonly files: Awaited<ReturnType<typeof loadConfigFiles>>;
  readonly prev: PreviousState;
  readonly fx: ResolveFxResult;
  readonly outcomes: readonly SourceOutcome[];
  readonly rec: ReconcileResult;
  readonly metadata: readonly ModelMetadata[];
  readonly prevMedia: PreviousMediaState;
  readonly mediaRec: ReconcileResult;
  readonly verification: VerifyResult;
}

async function gather(opts: RunOptions): Promise<Gathered> {
  const { config, logger } = opts;
  const startedAt = opts.clock();
  const nowIso = toIsoSeconds(startedAt);
  const today = shanghaiDate(startedAt);
  const [files, prev, prevMedia] = await Promise.all([
    loadConfigFiles(opts.rootDir),
    loadPreviousState(opts.dataDir),
    loadPreviousMediaState(opts.dataDir),
  ]);
  const previous = prev.latest?.offerings ?? [];
  const fx = await resolveFx({
    http: opts.http,
    previous: prev.fx,
    now: startedAt,
    fallbackRate: config.fxFallbackRate,
    logger,
  });
  logger.info("汇率", { usdCny: fx.rate.usdCny, provider: fx.rate.provider });
  const previousMedia = (prevMedia.latest?.offerings ?? []).map(toLaneOffering);
  const sourceRun = {
    sources: opts.sources,
    ctx: { http: opts.http, browser: opts.browser, logger, now: startedAt, rootDir: opts.rootDir },
    providers: files.providers,
    aliases: files.aliases,
    usdCny: fx.rate.usdCny,
    previous,
    previousMedia,
    clock: () => opts.clock().getTime(),
  };
  const outcomes = await runSources({ ...sourceRun, selected: opts.selected });
  const overrides = activeOverrides(files.overrides, today);
  const verification = await verifyApiAnomalies({
    outcomes,
    previous: [...previous, ...previousMedia],
    overrides,
    threshold: config.anomalyThreshold,
    rerun: (ids) => runSources({ ...sourceRun, selected: ids }),
    logger,
  });
  const rec = reconcile({
    previous,
    previousDataDate: prev.latest?.dataDate ?? null,
    outcomes,
    quarantine: prev.quarantine,
    overrides,
    threshold: config.anomalyThreshold,
    nowIso,
    today,
    verified: verification.verified,
  });
  const metadata = resolveMetadata(
    await fetchModelsDevMetadata(opts.http, logger),
    createVendorMatcher(files.providers),
    createAliasResolver(files.aliases),
  );
  const mediaRec = reconcileMedia({
    prev: prevMedia,
    outcomes,
    overrides,
    threshold: config.anomalyThreshold,
    nowIso,
    today,
    verified: verification.verified,
  });
  return {
    startedAt,
    nowIso,
    today,
    files,
    prev,
    fx,
    outcomes,
    rec,
    metadata,
    prevMedia,
    mediaRec,
    verification,
  };
}

function collectWarnings(
  opts: RunOptions,
  g: Gathered,
  healthWarnings: readonly Warning[],
): Warning[] {
  const ranManual = g.outcomes.some(
    (o) => (o.id === "manual" || o.id === "manual-cn") && o.state !== "skipped",
  );
  return sortWarnings([
    ...opts.configWarnings,
    ...g.fx.warnings,
    ...g.outcomes.flatMap((o) => o.warnings),
    ...g.rec.warnings,
    ...g.mediaRec.warnings,
    ...g.verification.warnings,
    ...crossCheck(g.rec.offerings, g.fx.rate.usdCny),
    ...healthWarnings,
    ...(ranManual ? checkManualFreshness(g.files.manual, g.startedAt) : []),
  ]);
}

function buildStatus(opts: RunOptions, g: Gathered): StatusFile {
  const health = buildSourceResults({
    outcomes: g.outcomes,
    previous: g.prev.status?.sources ?? [],
    nowIso: g.nowIso,
    staleAlertDays: opts.config.staleAlertDays,
  });
  const finishedAt = opts.clock();
  return {
    run: {
      id: opts.config.runId ?? localRunId(g.startedAt),
      startedAt: g.nowIso,
      finishedAt: toIsoSeconds(finishedAt),
      durationMs: Math.max(0, finishedAt.getTime() - g.startedAt.getTime()),
      result: runResult(g.outcomes),
    },
    sources: [...health.results],
    quarantine: [...g.rec.quarantine],
    warnings: collectWarnings(opts, g, health.warnings),
  };
}

interface Analyzed {
  readonly events: readonly ChangeEvent[];
  readonly planned: readonly PlannedFile[];
  readonly status: StatusFile;
  readonly latestUnchanged: boolean;
  readonly media: MediaAnalyzed;
}

/** 本次成功、但以前从未成功过的源：首次接入只建立基线，不刷屏 new_model */
function baselineSources(g: Gathered): ReadonlySet<string> {
  const succeededBefore = new Set(
    (g.prev.status?.sources ?? []).filter((s) => s.lastSuccessAt !== null).map((s) => s.id),
  );
  return new Set(
    g.outcomes.filter((o) => o.state === "ok" && !succeededBefore.has(o.id)).map((o) => o.id),
  );
}

async function analyze(opts: RunOptions, g: Gathered): Promise<Analyzed> {
  const { today, nowIso } = g;
  const previous = g.prev.latest?.offerings ?? [];
  const enriched = enrichMetadata(g.rec.offerings, g.metadata, previous);
  const rec = { ...g.rec, offerings: harmonizeDisplayNames(enriched) };
  const month = monthOf(today);
  const existingMonth = await loadChangesMonth(opts.dataDir, month);
  const events = diffOfferings({
    previous,
    next: rec.offerings,
    confirmed: rec.confirmed,
    nowIso,
    today,
    existingEvents: existingMonth?.events ?? [],
    baselineSources: baselineSources(g),
  });
  const media = await analyzeMedia({
    dataDir: opts.dataDir,
    prev: g.prevMedia,
    rec: { ...g.mediaRec, offerings: unifyDisplayNames(g.mediaRec.offerings) },
    outcomes: g.outcomes,
    baselineSources: baselineSources(g),
    nowIso,
    today,
  });
  const existingHistory = await loadHistoryFiles(
    opts.dataDir,
    rec.offerings.map((o) => o.modelSlug),
  );
  const history = planHistoryUpdates({
    offerings: rec.offerings,
    existing: existingHistory,
    today,
  });
  const status = buildStatus(opts, g);
  const latest = buildLatestFile(rec.offerings, nowIso, today);
  const latestUnchanged = isLatestUnchanged(g.prev.latest, latest);
  const planned = planOutputFiles({
    latest: latestUnchanged ? null : latest,
    history,
    changes: events.length > 0 ? mergeMonthEvents(month, existingMonth, events) : null,
    quarantine: rec.quarantine,
    fx: g.fx.file,
    status,
  });
  return { events, planned: [...planned, ...media.planned], status, latestUnchanged, media };
}

export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const { config, logger } = opts;
  const g = await gather(opts);
  const { events, planned, status, latestUnchanged, media } = await analyze(opts, g);
  const written = opts.dryRun ? [] : await persistFiles(opts.dataDir, planned);
  logger.info("落盘完成", { files: written.length, latestUnchanged, dryRun: opts.dryRun });

  const ranSourceIds = new Set(g.outcomes.filter((o) => o.state !== "skipped").map((o) => o.id));
  const report = buildDailyReport({
    today: g.today,
    status,
    ranSourceIds,
    events,
    newlyQuarantined: [...g.rec.newlyQuarantined, ...g.mediaRec.newlyQuarantined],
    offerings: g.rec.offerings,
    media,
    siteUrl: config.siteUrl,
  });
  if (!opts.dryRun && opts.notify && shouldNotify(report, config.notifyOnSuccess)) {
    await sendReport(opts.notifiers, report, logger);
  }
  const summary = buildSummaryMarkdown({
    report,
    status,
    offerings: g.rec.offerings,
    mediaOfferings: media.offerings,
    written,
    latestUnchanged,
    dryRun: opts.dryRun,
  });
  if (config.stepSummaryPath) await writeStepSummary(config.stepSummaryPath, summary, logger);
  return {
    exitCode: status.run.result === "failed" ? 1 : 0,
    status,
    events,
    offerings: g.rec.offerings,
    mediaOfferings: media.offerings,
    mediaEvents: media.events,
    written,
    latestUnchanged,
    summary,
  };
}

async function writeStepSummary(file: string, summary: string, logger: Logger): Promise<void> {
  try {
    await appendFile(file, summary, "utf8");
  } catch (error) {
    logger.warn("写入 GITHUB_STEP_SUMMARY 失败，已忽略", { error });
  }
}
