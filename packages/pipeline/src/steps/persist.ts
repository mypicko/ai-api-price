/**
 * Persist（DEV_DOCUMENT §3.8）：
 * 1. 全部写入 data/.tmp/
 * 2. 读回临时文件，用 schema 再校验一遍
 * 3. 逐个 rename 到 data/（同一文件系统内 rename 是原子的）
 * 任一步失败抛 E4001，已有数据不受影响。
 * 输出统一 2 空格缩进 + 末尾换行；键顺序由 schema 决定，数组排序由调用方保证。
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { PipelineError } from "../core/errors";

export const TMP_DIR_NAME = ".tmp";

export interface PlannedFile {
  /** 相对 data/ 的路径，例如 "history/openai/gpt-4o.json" */
  readonly path: string;
  readonly schema: z.ZodType;
  readonly content: unknown;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertSafePath(relative: string): void {
  const normalized = path.posix.normalize(relative);
  if (normalized !== relative || relative.startsWith("/") || relative.split("/").includes("..")) {
    throw new PipelineError("E4001", `非法的输出路径：${relative}`);
  }
}

function parseOrThrow(file: PlannedFile, data: unknown): unknown {
  const result = file.schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new PipelineError("E4001", `写入前校验失败：${file.path}：${detail}`);
  }
  return result.data;
}

async function writeTmp(tmpDir: string, file: PlannedFile): Promise<void> {
  const canonical = parseOrThrow(file, file.content);
  const target = path.join(tmpDir, file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, serializeJson(canonical), "utf8");
}

async function verifyTmp(tmpDir: string, file: PlannedFile): Promise<void> {
  const text = await readFile(path.join(tmpDir, file.path), "utf8");
  parseOrThrow(file, JSON.parse(text));
}

async function moveIntoPlace(tmpDir: string, dataDir: string, file: PlannedFile): Promise<void> {
  const target = path.join(dataDir, file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await rename(path.join(tmpDir, file.path), target);
}

/** 返回写入的相对路径（已排序） */
export async function persistFiles(
  dataDir: string,
  files: readonly PlannedFile[],
): Promise<readonly string[]> {
  files.forEach((f) => assertSafePath(f.path));
  const tmpDir = path.join(dataDir, TMP_DIR_NAME);
  try {
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });
    await Promise.all(files.map((f) => writeTmp(tmpDir, f)));
    await Promise.all(files.map((f) => verifyTmp(tmpDir, f)));
    for (const file of files) await moveIntoPlace(tmpDir, dataDir, file);
    return files.map((f) => f.path).toSorted();
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError("E4001", `写入 data/ 失败`, { cause: error });
  } finally {
    // 清理临时目录失败不影响结果（主错误已经抛出 / 文件已就位），下次运行开头会再清理一次
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
