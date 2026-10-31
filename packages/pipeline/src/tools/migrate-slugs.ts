/**
 * `pnpm pipeline migrate-slugs [--dry-run]`（DEV §3.23）：模型 ID 规则改了以后，把 data/ 里已有的数据
 * 改名并合并到新的 ID 下，避免下次运行把旧 ID 当成「下架」、新 ID 当成「上新」。
 * - latest.json / media/latest.json：重算 ID；同一平台撞到同一个新 ID 时保留一条
 *   （在售 > 待确认下架 > 已下架，其次数据源优先级高的，再其次抓取时间新的），firstSeenAt 取较早的
 * - history/**：文件按新 slug 合并，序列按新 offeringId 改名；撞名时保留上面选中的那条的序列
 * - changes/*.json：事件的 offeringId、modelSlug、id 改名；改名后完全相同的事件去重
 * - quarantine.json / media/quarantine.json：offeringId 改名
 * 规则本身在 normalize 的 resolveAlias 里（aliases.yaml + canonicalModelId），这里只负责搬数据。可重复执行。
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  ChangesMonthFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  MediaLatestFileSchema,
  QuarantineFileSchema,
  makeModelSlug,
  makeOfferingId,
  parseOfferingId,
  type ChangeEvent,
  type ChangesMonthFile,
  type HistoryFile,
  type QuarantineEntry,
} from "@aipb/shared";
import type { z } from "zod";
import { isNotFound } from "../config-files";
import type { AliasResolver } from "../steps/normalize";
import { sourcePriority } from "../steps/normalize";
import { persistFiles, type PlannedFile } from "../steps/persist";

/** 旧 offeringId → 新 offeringId；不变或无法解析时返回原值 */
export type IdMapper = (offeringId: string) => string;

export function createIdMapper(resolve: AliasResolver): IdMapper {
  return (offeringId) => {
    const parsed = parseOfferingId(offeringId);
    if (!parsed) return offeringId;
    const model = resolve(parsed.vendor, parsed.model);
    return makeOfferingId(parsed.platform, parsed.vendor, model);
  };
}

export function slugOf(offeringId: string): string {
  const parsed = parseOfferingId(offeringId);
  return parsed ? makeModelSlug(parsed.vendor, parsed.model) : offeringId;
}

interface MigratableOffering {
  readonly id: string;
  readonly model: string;
  readonly modelSlug: string;
  readonly status: "active" | "missing" | "removed";
  readonly source: string;
  readonly fetchedAt: string;
  readonly firstSeenAt: string;
  readonly input: number | null;
}

const STATUS_RANK = { active: 2, missing: 1, removed: 0 } as const;

interface Candidate<T> {
  readonly offering: T;
  /** 原 ID 已经是新 ID（不是改名过来的） */
  readonly unchanged: boolean;
}

/**
 * 同一新 ID 下的两条，返回应当保留的那条：在售 > 待确认下架 > 已下架，其次数据源优先级高的，
 * 再其次原本就叫这个名字的、输入价低的（同一来源撞名多半是按区域单列的贵价条目，标准价更低）
 */
function better<T extends MigratableOffering>(a: Candidate<T>, b: Candidate<T>): Candidate<T> {
  const byStatus = STATUS_RANK[a.offering.status] - STATUS_RANK[b.offering.status];
  if (byStatus !== 0) return byStatus > 0 ? a : b;
  const byPriority = sourcePriority(a.offering.source) - sourcePriority(b.offering.source);
  if (byPriority !== 0) return byPriority > 0 ? a : b;
  if (a.unchanged !== b.unchanged) return a.unchanged ? a : b;
  const ia = a.offering.input ?? Infinity;
  const ib = b.offering.input ?? Infinity;
  if (ia !== ib) return ia < ib ? a : b;
  return a.offering.fetchedAt >= b.offering.fetchedAt ? a : b;
}

export interface OfferingMigration<T> {
  readonly offerings: readonly T[];
  /** 新 offeringId → 保留下来的那条的旧 offeringId（历史序列以它为准） */
  readonly keptFrom: ReadonlyMap<string, string>;
  readonly renamed: number;
  readonly merged: number;
}

export function migrateOfferings<T extends MigratableOffering>(
  offerings: readonly T[],
  mapId: IdMapper,
): OfferingMigration<T> {
  const byNewId = new Map<string, { kept: Candidate<T>; oldId: string; firstSeenAt: string }>();
  let renamed = 0;
  for (const offering of offerings) {
    const newId = mapId(offering.id);
    const parsed = parseOfferingId(newId);
    const unchanged = newId === offering.id;
    if (!unchanged) renamed += 1;
    const moved: T =
      unchanged || !parsed
        ? offering
        : { ...offering, id: newId, model: parsed.model, modelSlug: slugOf(newId) };
    const candidate: Candidate<T> = { offering: moved, unchanged };
    const current = byNewId.get(newId);
    if (!current) {
      byNewId.set(newId, { kept: candidate, oldId: offering.id, firstSeenAt: moved.firstSeenAt });
      continue;
    }
    const kept = better(current.kept, candidate);
    byNewId.set(newId, {
      kept,
      oldId: kept === candidate ? offering.id : current.oldId,
      firstSeenAt:
        current.firstSeenAt < moved.firstSeenAt ? current.firstSeenAt : moved.firstSeenAt,
    });
  }
  const result = [...byNewId.values()]
    .map(({ kept, firstSeenAt }) => ({ ...kept.offering, firstSeenAt }))
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    offerings: result,
    keptFrom: new Map([...byNewId.entries()].map(([id, v]) => [id, v.oldId])),
    renamed,
    merged: offerings.length - result.length,
  };
}

/** 历史文件按新 slug 合并；序列撞名时保留 keptFrom 指定的那条，没有指定时保留点数多的 */
export function migrateHistory(
  files: readonly HistoryFile[],
  mapId: IdMapper,
  keptFrom: ReadonlyMap<string, string>,
): readonly HistoryFile[] {
  const bySlug = new Map<
    string,
    Map<string, { oldId: string; points: HistoryFile["series"][string] }>
  >();
  for (const file of files) {
    for (const [oldId, points] of Object.entries(file.series)) {
      const newId = mapId(oldId);
      const slug = slugOf(newId);
      const series = bySlug.get(slug) ?? new Map();
      bySlug.set(slug, series);
      const current = series.get(newId);
      const preferred = keptFrom.get(newId);
      const takeNew =
        !current ||
        (preferred !== undefined
          ? oldId === preferred && current.oldId !== preferred
          : points.length > current.points.length);
      if (takeNew) series.set(newId, { oldId, points });
    }
  }
  return [...bySlug.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([modelSlug, series]) => ({
      modelSlug,
      // 保持原有顺序，没改名的文件写回后内容不变
      series: Object.fromEntries([...series.entries()].map(([id, v]) => [id, v.points])),
    }));
}

/** 事件 ID 形如 <YYYY-MM-DD>-<offeringId>-<序号> */
function renameEventId(event: ChangeEvent, newOfferingId: string): string {
  const prefix = `${event.detectedAt.slice(0, 10)}-${event.offeringId}-`;
  return event.id.startsWith(prefix)
    ? `${event.detectedAt.slice(0, 10)}-${newOfferingId}-${event.id.slice(prefix.length)}`
    : event.id.replace(event.offeringId, newOfferingId);
}

function eventContentKey(e: ChangeEvent): string {
  return JSON.stringify([e.type, e.offeringId, e.detectedAt.slice(0, 10), e.fields]);
}

export function migrateChanges(file: ChangesMonthFile, mapId: IdMapper): ChangesMonthFile {
  const seenContent = new Set<string>();
  const usedIds = new Set<string>();
  const events: ChangeEvent[] = [];
  for (const event of file.events) {
    const newOfferingId = mapId(event.offeringId);
    const renamed: ChangeEvent =
      newOfferingId === event.offeringId
        ? event
        : {
            ...event,
            id: renameEventId(event, newOfferingId),
            offeringId: newOfferingId,
            modelSlug: slugOf(newOfferingId),
          };
    const key = eventContentKey(renamed);
    if (seenContent.has(key)) continue;
    seenContent.add(key);
    let id = renamed.id;
    for (let n = 2; usedIds.has(id); n += 1) id = `${renamed.id}-${n}`;
    usedIds.add(id);
    events.push(id === renamed.id ? renamed : { ...renamed, id });
  }
  return {
    month: file.month,
    events: events.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export function migrateQuarantine(
  entries: readonly QuarantineEntry[],
  mapId: IdMapper,
): readonly QuarantineEntry[] {
  const byId = new Map<string, QuarantineEntry>();
  for (const entry of entries) {
    const offeringId = mapId(entry.offeringId);
    const current = byId.get(offeringId);
    if (!current || entry.lastSeenAt > current.lastSeenAt)
      byId.set(offeringId, { ...entry, offeringId });
  }
  return [...byId.values()].toSorted((a, b) => a.offeringId.localeCompare(b.offeringId));
}

// ---------- 读写 data/ ----------

async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function listJson(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

export interface MigrationSummary {
  readonly renamedOfferings: number;
  readonly mergedOfferings: number;
  readonly historyFilesBefore: number;
  readonly historyFilesAfter: number;
  readonly written: readonly string[];
  readonly removed: readonly string[];
}

interface LaneResult {
  readonly planned: PlannedFile[];
  readonly staleHistory: string[];
  readonly renamed: number;
  readonly merged: number;
  readonly historyBefore: number;
  readonly historyAfter: number;
}

async function migrateLane(
  dataDir: string,
  lane: "" | "media/",
  mapId: IdMapper,
): Promise<LaneResult> {
  const latestSchema = lane === "" ? LatestFileSchema : MediaLatestFileSchema;
  // 文本和视频/图像的 latest 结构不同，这里只用到 offerings 的公共字段
  const latest = await readJson(
    path.join(dataDir, `${lane}latest.json`),
    latestSchema as unknown as z.ZodType<{ readonly offerings: readonly unknown[] }>,
  );
  const planned: PlannedFile[] = [];
  let keptFrom: ReadonlyMap<string, string> = new Map();
  let renamed = 0;
  let merged = 0;
  if (latest) {
    const result = migrateOfferings(latest.offerings as readonly MigratableOffering[], mapId);
    keptFrom = result.keptFrom;
    renamed = result.renamed;
    merged = result.merged;
    planned.push({
      path: `${lane}latest.json`,
      schema: latestSchema,
      content: { ...latest, offerings: result.offerings },
    });
  }
  const historyDir = path.join(dataDir, `${lane}history`);
  const historyPaths = await listJson(historyDir);
  const histories = await Promise.all(
    historyPaths.map(
      async (p) => (await readJson(path.join(historyDir, p), HistoryFileSchema)) as HistoryFile,
    ),
  );
  const migrated = migrateHistory(histories, mapId, keptFrom);
  const newPaths = new Set(migrated.map((h) => `${h.modelSlug}.json`));
  migrated.forEach((h) =>
    planned.push({
      path: `${lane}history/${h.modelSlug}.json`,
      schema: HistoryFileSchema,
      content: h,
    }),
  );
  const staleHistory = historyPaths
    .filter((p) => !newPaths.has(p))
    .map((p) => path.join(historyDir, p));
  const changesDir = path.join(dataDir, `${lane}changes`);
  for (const name of await listJson(changesDir)) {
    const file = await readJson(path.join(changesDir, name), ChangesMonthFileSchema);
    if (file)
      planned.push({
        path: `${lane}changes/${name}`,
        schema: ChangesMonthFileSchema,
        content: migrateChanges(file, mapId),
      });
  }
  const quarantine = await readJson(
    path.join(dataDir, `${lane}quarantine.json`),
    QuarantineFileSchema,
  );
  if (quarantine)
    planned.push({
      path: `${lane}quarantine.json`,
      schema: QuarantineFileSchema,
      content: { entries: migrateQuarantine(quarantine.entries, mapId) },
    });
  return {
    planned,
    staleHistory,
    renamed,
    merged,
    historyBefore: historyPaths.length,
    historyAfter: migrated.length,
  };
}

export async function migrateDataDir(
  dataDir: string,
  resolve: AliasResolver,
  options: { readonly dryRun: boolean },
): Promise<MigrationSummary> {
  const mapId = createIdMapper(resolve);
  const lanes = [
    await migrateLane(dataDir, "", mapId),
    await migrateLane(dataDir, "media/", mapId),
  ];
  const planned = lanes.flatMap((l) => l.planned);
  const stale = lanes.flatMap((l) => l.staleHistory);
  const summary = {
    renamedOfferings: lanes.reduce((n, l) => n + l.renamed, 0),
    mergedOfferings: lanes.reduce((n, l) => n + l.merged, 0),
    historyFilesBefore: lanes.reduce((n, l) => n + l.historyBefore, 0),
    historyFilesAfter: lanes.reduce((n, l) => n + l.historyAfter, 0),
    removed: stale.map((p) => path.relative(dataDir, p)).toSorted(),
  };
  if (options.dryRun) return { ...summary, written: [] };
  // 先写入新文件（原子），再删除已经合并走的旧历史文件
  const written = await persistFiles(dataDir, planned);
  await Promise.all(stale.map((p) => rm(p)));
  return { ...summary, written };
}
