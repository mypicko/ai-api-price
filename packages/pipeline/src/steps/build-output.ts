/**
 * 组装要写入 data/ 的文件。所有数组按 id 稳定排序，保证 git diff 干净。
 * latest.json 只有 generatedAt / dataDate / fetchedAt 变化时不重写，避免每天产生无意义的提交。
 */
import {
  ChangesMonthFileSchema,
  FxFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  QuarantineFileSchema,
  SCHEMA_VERSION,
  StatusFileSchema,
  type ChangeEvent,
  type ChangesMonthFile,
  type FxFile,
  type HistoryFile,
  type LatestFile,
  type Offering,
  type QuarantineEntry,
  type StatusFile,
  type Warning,
} from "@aipb/shared";
import { historyRelativePath } from "./history";
import type { PlannedFile } from "./persist";
import { offeringContentKey } from "./reconcile";

export function sortById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return items.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function sortWarnings(warnings: readonly Warning[]): Warning[] {
  const key = (w: Warning): string =>
    [w.code, w.sourceId ?? "", w.offeringId ?? "", w.message].join("\u0000");
  return warnings.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

export function buildLatestFile(
  offerings: readonly Offering[],
  generatedAt: string,
  dataDate: string,
): LatestFile {
  return { schemaVersion: SCHEMA_VERSION, generatedAt, dataDate, offerings: sortById(offerings) };
}

function latestContentKey(file: LatestFile): string {
  return [file.schemaVersion, ...sortById(file.offerings).map(offeringContentKey)].join("\n");
}

/** 内容（除时间戳外）完全相同时返回 true */
export function isLatestUnchanged(previous: LatestFile | null, next: LatestFile): boolean {
  return previous !== null && latestContentKey(previous) === latestContentKey(next);
}

export function mergeMonthEvents(
  month: string,
  existing: ChangesMonthFile | null,
  events: readonly ChangeEvent[],
): ChangesMonthFile {
  const byId = new Map([...(existing?.events ?? []), ...events].map((e) => [e.id, e] as const));
  return { month, events: sortById([...byId.values()]) };
}

export interface OutputInput {
  readonly latest: LatestFile | null;
  readonly history: ReadonlyMap<string, HistoryFile>;
  readonly changes: ChangesMonthFile | null;
  readonly quarantine: readonly QuarantineEntry[];
  readonly fx: FxFile;
  readonly status: StatusFile;
}

export function planOutputFiles(input: OutputInput): readonly PlannedFile[] {
  const latest: PlannedFile[] = input.latest
    ? [{ path: "latest.json", schema: LatestFileSchema, content: input.latest }]
    : [];
  const history = [...input.history.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([slug, file]): PlannedFile => ({
      path: historyRelativePath(slug),
      schema: HistoryFileSchema,
      content: file,
    }));
  const changes: PlannedFile[] = input.changes
    ? [
        {
          path: `changes/${input.changes.month}.json`,
          schema: ChangesMonthFileSchema,
          content: input.changes,
        },
      ]
    : [];
  const quarantine = [...input.quarantine].toSorted((a, b) =>
    a.offeringId.localeCompare(b.offeringId),
  );
  return [
    ...latest,
    ...history,
    ...changes,
    { path: "quarantine.json", schema: QuarantineFileSchema, content: { entries: quarantine } },
    { path: "fx.json", schema: FxFileSchema, content: input.fx },
    { path: "status.json", schema: StatusFileSchema, content: input.status },
  ];
}
