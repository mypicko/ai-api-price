/**
 * 视频/图像报价这条线（DEV_DOCUMENT §3.13）：数据写在 data/media/ 下，与文本报价完全分开，
 * 但复用同一套 reconcile（V3/V4/V6/V8）、diff、history 和原子写入。
 *
 *   data/media/latest.json            MediaLatestFile
 *   data/media/quarantine.json        隔离区
 *   data/media/history/<v>/<m>.json   变更点序列（input = 输入图价，output = 生成单价）
 *   data/media/changes/<YYYY-MM>.json 变动事件
 */
import path from "node:path";
import {
  ChangesMonthFileSchema,
  HistoryFileSchema,
  MediaLatestFileSchema,
  QuarantineFileSchema,
  SCHEMA_VERSION,
  type ChangeEvent,
  type ChangesMonthFile,
  type HistoryFile,
  type MediaLatestFile,
  type MediaOffering,
  type MediaUnit,
  type Offering,
  type Override,
  type QuarantineEntry,
} from "@aipb/shared";
import { PipelineError } from "../core/errors";
import { mergeMonthEvents, sortById } from "./build-output";
import { monthOf } from "./dates";
import { diffOfferings } from "./diff";
import { historyRelativePath, planHistoryUpdates } from "./history";
import type { PlannedFile } from "./persist";
import { reconcile, type ReconcileResult } from "./reconcile";
import { stableStringify } from "./stable-json";
import { loadChangesMonth, loadHistoryFiles, readJsonFile } from "./state";
import type { LaneOffering, SourceOutcome } from "./types";

export const MEDIA_DIR = "media";

export interface PreviousMediaState {
  readonly latest: MediaLatestFile | null;
  readonly quarantine: readonly QuarantineEntry[];
}

export async function loadPreviousMediaState(dataDir: string): Promise<PreviousMediaState> {
  const dir = path.join(dataDir, MEDIA_DIR);
  const [latest, quarantine] = await Promise.all([
    readJsonFile(path.join(dir, "latest.json"), MediaLatestFileSchema),
    readJsonFile(path.join(dir, "quarantine.json"), QuarantineFileSchema),
  ]);
  return { latest, quarantine: quarantine?.entries ?? [] };
}

/** 已发布的 MediaOffering → 管线内部形状 */
export function toLaneOffering(m: MediaOffering): LaneOffering {
  const { tiers, ...rest } = m;
  return {
    ...rest,
    // 与 reconcile 的 isFree 口径一致，避免 publishedAt 每天被误判为变化
    isFree: m.input === 0 && m.output === 0,
    cacheRead: null,
    cacheWrite: null,
    tiers: null,
    contextWindow: null,
    maxOutput: null,
    mediaTiers: tiers,
  };
}

function isLaneOffering(o: Offering): o is LaneOffering {
  return "kind" in o && "unit" in o && "mediaTiers" in o;
}

/** 管线内部形状 → 发布用的 MediaOffering（字段顺序按 schema） */
export function toMediaOffering(o: Offering): MediaOffering {
  if (!isLaneOffering(o)) throw new PipelineError("E4001", `视频/图像报价缺少媒体字段：${o.id}`);
  return {
    id: o.id,
    vendor: o.vendor,
    model: o.model,
    modelSlug: o.modelSlug,
    displayName: o.displayName,
    platform: o.platform,
    source: o.source,
    currency: o.currency,
    kind: o.kind,
    unit: o.unit,
    input: o.input,
    output: o.output,
    tiers: o.mediaTiers === null ? null : [...o.mediaTiers],
    modalities: o.modalities,
    isFree: o.output === 0,
    stale: o.stale,
    status: o.status,
    missingDays: o.missingDays,
    sourceUrl: o.sourceUrl,
    notes: o.notes,
    firstSeenAt: o.firstSeenAt,
    fetchedAt: o.fetchedAt,
    publishedAt: o.publishedAt,
  };
}

/** 把各源的 media 线展开成 reconcile 能直接用的 SourceOutcome */
export function mediaOutcomes(outcomes: readonly SourceOutcome[]): readonly SourceOutcome[] {
  return outcomes.map((o) => ({
    ...o,
    state: o.media?.state ?? o.state,
    candidates: o.media?.candidates ?? [],
    invalidIds: o.media?.invalidIds ?? [],
    offeringCount: o.media?.offeringCount ?? 0,
  }));
}

export interface MediaReconcileInput {
  readonly prev: PreviousMediaState;
  readonly outcomes: readonly SourceOutcome[];
  readonly overrides: ReadonlyMap<string, Override>;
  readonly threshold: number;
  readonly nowIso: string;
  readonly today: string;
}

export function reconcileMedia(input: MediaReconcileInput): ReconcileResult {
  return reconcile({
    previous: (input.prev.latest?.offerings ?? []).map(toLaneOffering),
    previousDataDate: input.prev.latest?.dataDate ?? null,
    outcomes: mediaOutcomes(input.outcomes),
    quarantine: input.prev.quarantine,
    overrides: input.overrides,
    threshold: input.threshold,
    nowIso: input.nowIso,
    today: input.today,
  });
}

export function buildMediaLatestFile(
  offerings: readonly MediaOffering[],
  generatedAt: string,
  dataDate: string,
): MediaLatestFile {
  return { schemaVersion: SCHEMA_VERSION, generatedAt, dataDate, offerings: sortById(offerings) };
}

const VOLATILE_KEYS: ReadonlySet<string> = new Set(["fetchedAt", "publishedAt"]);

function mediaContentKey(file: MediaLatestFile): string {
  const offerings = sortById(file.offerings).map((o) =>
    stableStringify(Object.fromEntries(Object.entries(o).filter(([k]) => !VOLATILE_KEYS.has(k)))),
  );
  return [file.schemaVersion, ...offerings].join("\n");
}

export function isMediaLatestUnchanged(
  previous: MediaLatestFile | null,
  next: MediaLatestFile,
): boolean {
  return previous !== null && mediaContentKey(previous) === mediaContentKey(next);
}

export interface MediaAnalyzeInput {
  readonly dataDir: string;
  readonly prev: PreviousMediaState;
  readonly rec: ReconcileResult;
  readonly outcomes: readonly SourceOutcome[];
  /** 文本线判定的首次接入源 */
  readonly baselineSources: ReadonlySet<string>;
  readonly nowIso: string;
  readonly today: string;
}

export interface MediaAnalyzed {
  readonly offerings: readonly MediaOffering[];
  readonly events: readonly ChangeEvent[];
  readonly planned: readonly PlannedFile[];
  readonly latestUnchanged: boolean;
  /** offeringId → 计价单位（推送消息格式化价格用） */
  readonly units: Readonly<Record<string, MediaUnit>>;
}

/** 某个源第一次产出视频/图像数据时只建立基线，不为几十个模型刷 new_model */
function mediaBaseline(input: MediaAnalyzeInput): ReadonlySet<string> {
  const seen = new Set((input.prev.latest?.offerings ?? []).map((o) => o.source));
  const firstTime = input.outcomes
    .filter((o) => o.media?.state === "ok" && !seen.has(o.id))
    .map((o) => o.id);
  return new Set([...input.baselineSources, ...firstTime]);
}

function planFiles(
  latest: MediaLatestFile | null,
  history: ReadonlyMap<string, HistoryFile>,
  changes: ChangesMonthFile | null,
  quarantine: readonly QuarantineEntry[],
): readonly PlannedFile[] {
  const prefix = (p: string): string => `${MEDIA_DIR}/${p}`;
  const latestFiles: PlannedFile[] = latest
    ? [{ path: prefix("latest.json"), schema: MediaLatestFileSchema, content: latest }]
    : [];
  const historyFiles = [...history.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([slug, file]): PlannedFile => ({
      path: prefix(historyRelativePath(slug)),
      schema: HistoryFileSchema,
      content: file,
    }));
  const changeFiles: PlannedFile[] = changes
    ? [
        {
          path: prefix(`changes/${changes.month}.json`),
          schema: ChangesMonthFileSchema,
          content: changes,
        },
      ]
    : [];
  const entries = quarantine.toSorted((a, b) => a.offeringId.localeCompare(b.offeringId));
  return [
    ...latestFiles,
    ...historyFiles,
    ...changeFiles,
    { path: prefix("quarantine.json"), schema: QuarantineFileSchema, content: { entries } },
  ];
}

export async function analyzeMedia(input: MediaAnalyzeInput): Promise<MediaAnalyzed> {
  const { rec, today, nowIso } = input;
  const dir = path.join(input.dataDir, MEDIA_DIR);
  const previous = (input.prev.latest?.offerings ?? []).map(toLaneOffering);
  const month = monthOf(today);
  const existingMonth = await loadChangesMonth(dir, month);
  const events = diffOfferings({
    previous,
    next: rec.offerings,
    confirmed: rec.confirmed,
    nowIso,
    today,
    existingEvents: existingMonth?.events ?? [],
    baselineSources: mediaBaseline(input),
  });
  const existingHistory = await loadHistoryFiles(
    dir,
    rec.offerings.map((o) => o.modelSlug),
  );
  const history = planHistoryUpdates({
    offerings: rec.offerings,
    existing: existingHistory,
    today,
  });
  const offerings = rec.offerings.map(toMediaOffering);
  const latest = buildMediaLatestFile(offerings, nowIso, today);
  const latestUnchanged = isMediaLatestUnchanged(input.prev.latest, latest);
  const changes = events.length > 0 ? mergeMonthEvents(month, existingMonth, events) : null;
  return {
    offerings,
    events,
    planned: planFiles(latestUnchanged ? null : latest, history, changes, rec.quarantine),
    latestUnchanged,
    units: Object.fromEntries(offerings.map((o) => [o.id, o.unit] as const)),
  };
}
