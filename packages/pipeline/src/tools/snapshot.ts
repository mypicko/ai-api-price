/**
 * `pnpm pipeline snapshot <sourceId>`：用会录制响应体的 HttpClient / BrowserClient 运行一次该源，
 * 把原文保存到 packages/pipeline/tests/fixtures/<sourceId>/<YYYY-MM-DD>-<n>.<html|json>（DEV §12）。
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isNotFound } from "../config-files";
import type { BrowserClient } from "../core/browser";
import { PipelineError, toPipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import type { Source, SourceContext } from "../sources/types";
import { shanghaiDate } from "../steps/dates";

export type SnapshotExt = "html" | "json";

export interface SnapshotWriter {
  save(body: string, ext: SnapshotExt): Promise<string>;
  readonly written: () => readonly string[];
}

async function nextIndex(dir: string, date: string): Promise<number> {
  let names: readonly string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  const pattern = new RegExp(`^${date}-(\\d+)\\.`);
  const used = names.flatMap((n) => {
    const m = pattern.exec(n);
    return m?.[1] ? [Number(m[1])] : [];
  });
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

/** 串行写入，保证编号连续 */
export function createSnapshotWriter(dir: string, date: string): SnapshotWriter {
  let queue: Promise<unknown> = Promise.resolve();
  let written: readonly string[] = [];
  return {
    save(body, ext) {
      const task = queue.then(async () => {
        await mkdir(dir, { recursive: true });
        const file = path.join(dir, `${date}-${await nextIndex(dir, date)}.${ext}`);
        await writeFile(file, body, "utf8");
        written = [...written, file];
        return file;
      });
      queue = task.catch(() => undefined);
      return task;
    },
    written: () => written,
  };
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function createRecordingHttp(inner: HttpClient, writer: SnapshotWriter): HttpClient {
  return {
    async getText(url, options) {
      const text = await inner.getText(url, options);
      await writer.save(text, looksLikeJson(text) ? "json" : "html");
      return text;
    },
    async getJson<T>(url: string, options?: Parameters<HttpClient["getJson"]>[1]): Promise<T> {
      const text = await inner.getText(url, options);
      await writer.save(text, "json");
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new PipelineError("E2001", `响应不是合法 JSON：${url}`, { cause: error });
      }
    },
    post: (url, body, options) => inner.post(url, body, options),
  };
}

export function createRecordingBrowser(
  inner: BrowserClient,
  writer: SnapshotWriter,
): BrowserClient {
  return {
    async render(url, options) {
      const html = await inner.render(url, options);
      await writer.save(html, "html");
      return html;
    },
    close: () => inner.close(),
  };
}

export interface SnapshotInput {
  readonly source: Source;
  readonly ctx: SourceContext;
  /** packages/pipeline/tests/fixtures */
  readonly fixturesRoot: string;
}

export interface SnapshotResult {
  readonly files: readonly string[];
  readonly offeringCount: number;
  /** 解析失败时快照照样保存，方便对着新页面修抓取器 */
  readonly error: PipelineError | null;
}

export async function runSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
  const dir = path.join(input.fixturesRoot, input.source.id);
  const writer = createSnapshotWriter(dir, shanghaiDate(input.ctx.now));
  const ctx: SourceContext = {
    ...input.ctx,
    http: createRecordingHttp(input.ctx.http, writer),
    browser: createRecordingBrowser(input.ctx.browser, writer),
  };
  try {
    const offerings = await input.source.fetch(ctx);
    return { files: writer.written(), offeringCount: offerings.length, error: null };
  } catch (error) {
    return {
      files: writer.written(),
      offeringCount: 0,
      error: toPipelineError(error, "E2001", input.source.id),
    };
  }
}
