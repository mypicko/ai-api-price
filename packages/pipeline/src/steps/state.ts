/**
 * 读取上次已发布的数据（data/）。文件不存在视为第一次运行；文件存在但不合法时抛 E4001，
 * 避免用坏数据覆盖历史。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ChangesMonthFileSchema,
  FxFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  QuarantineFileSchema,
  StatusFileSchema,
  type ChangesMonthFile,
  type FxFile,
  type HistoryFile,
  type LatestFile,
  type QuarantineEntry,
  type StatusFile,
} from "@aipb/shared";
import type { z } from "zod";
import { isNotFound } from "../config-files";
import { PipelineError } from "../core/errors";
import { historyRelativePath } from "./history";

export interface PreviousState {
  readonly latest: LatestFile | null;
  readonly quarantine: readonly QuarantineEntry[];
  readonly fx: FxFile | null;
  readonly status: StatusFile | null;
}

export async function readJsonFile<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new PipelineError("E4001", `读取失败：${file}`, { cause: error });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new PipelineError("E4001", `不是合法 JSON：${file}`, { cause: error });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new PipelineError("E4001", `不符合 schema：${file}：${detail}`);
  }
  return result.data;
}

export async function loadPreviousState(dataDir: string): Promise<PreviousState> {
  const [latest, quarantine, fx, status] = await Promise.all([
    readJsonFile(path.join(dataDir, "latest.json"), LatestFileSchema),
    readJsonFile(path.join(dataDir, "quarantine.json"), QuarantineFileSchema),
    readJsonFile(path.join(dataDir, "fx.json"), FxFileSchema),
    readJsonFile(path.join(dataDir, "status.json"), StatusFileSchema),
  ]);
  return { latest, quarantine: quarantine?.entries ?? [], fx, status };
}

export async function loadHistoryFiles(
  dataDir: string,
  modelSlugs: readonly string[],
): Promise<ReadonlyMap<string, HistoryFile>> {
  const unique = [...new Set(modelSlugs)];
  const files = await Promise.all(
    unique.map(
      async (slug) =>
        [
          slug,
          await readJsonFile(path.join(dataDir, historyRelativePath(slug)), HistoryFileSchema),
        ] as const,
    ),
  );
  return new Map(
    files.filter((entry): entry is readonly [string, HistoryFile] => entry[1] !== null),
  );
}

export async function loadChangesMonth(
  dataDir: string,
  month: string,
): Promise<ChangesMonthFile | null> {
  return readJsonFile(path.join(dataDir, "changes", `${month}.json`), ChangesMonthFileSchema);
}
