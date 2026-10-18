/**
 * `pnpm pipeline validate`：用 schema 校验 data/ 下的全部 JSON 文件。
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ChangesMonthFileSchema,
  FxFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  QuarantineFileSchema,
  StatusFileSchema,
} from "@aipb/shared";
import type { z } from "zod";
import { isNotFound } from "../config-files";
import { TMP_DIR_NAME } from "../steps/persist";

export interface FileCheck {
  readonly file: string;
  readonly ok: boolean;
  readonly error: string | null;
}

const FIXED_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "latest.json": LatestFileSchema,
  "quarantine.json": QuarantineFileSchema,
  "fx.json": FxFileSchema,
  "status.json": StatusFileSchema,
};

export function schemaFor(relative: string): z.ZodType | null {
  const fixed = FIXED_SCHEMAS[relative];
  if (fixed) return fixed;
  if (/^history\/[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*\.json$/.test(relative))
    return HistoryFileSchema;
  if (/^changes\/\d{4}-\d{2}\.json$/.test(relative)) return ChangesMonthFileSchema;
  return null;
}

async function listJsonFiles(dir: string, prefix = ""): Promise<readonly string[]> {
  let entries: readonly Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const nested = await Promise.all(
    entries
      .filter((e) => e.name !== TMP_DIR_NAME)
      .map(async (e) => {
        const relative = prefix === "" ? e.name : `${prefix}/${e.name}`;
        if (e.isDirectory()) return listJsonFiles(path.join(dir, e.name), relative);
        return e.name.endsWith(".json") ? [relative] : [];
      }),
  );
  return nested.flat().toSorted();
}

async function checkFile(dataDir: string, relative: string): Promise<FileCheck> {
  const schema = schemaFor(relative);
  if (!schema) return { file: relative, ok: false, error: "未知文件（不在 data/ 约定的结构内）" };
  try {
    const result = schema.safeParse(
      JSON.parse(await readFile(path.join(dataDir, relative), "utf8")),
    );
    if (result.success) return { file: relative, ok: true, error: null };
    const detail = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { file: relative, ok: false, error: detail };
  } catch (error) {
    return {
      file: relative,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function validateDataDir(dataDir: string): Promise<readonly FileCheck[]> {
  const files = await listJsonFiles(dataDir);
  return Promise.all(files.map((f) => checkFile(dataDir, f)));
}
