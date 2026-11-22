/**
 * `wechat:weekly [YYYY-MM-DD] [--preview] [--monday-only]`：生成公众号周报（DEV_DOCUMENT §3.31）。
 * 日期是运行日（默认北京时间今天），统计它之前的那一周（周一到周日）。
 * --preview 只写本地预览 .preview/wechat-weekly-<结束日>.html；--monday-only 不是周一时直接跳过（每日任务用）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChangeEvent } from "@aipb/shared";
import type { WechatArticle } from "../notify/wechat-article";
import { loadArticleData } from "../notify/wechat-context";
import { buildWeeklyArticle, weekRange } from "../notify/wechat-weekly";
import { loadChangesMonth } from "../steps/state";
import { previewPage } from "./wechat-preview";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface WeeklyResult {
  readonly start: string;
  readonly end: string;
  readonly article: WechatArticle | null;
}

/** 一周可能跨月：读开始和结束两个月的变动，按事件 ID 开头的日期筛选 */
async function weekEvents(dataDir: string, start: string, end: string): Promise<ChangeEvent[]> {
  const months = [...new Set([start.slice(0, 7), end.slice(0, 7)])];
  const files = await Promise.all(months.map((m) => loadChangesMonth(dataDir, m)));
  return files
    .flatMap((f) => f?.events ?? [])
    .filter((e) => {
      const date = e.id.slice(0, 10);
      return date >= start && date <= end;
    });
}

export async function buildWeekly(opts: {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly siteUrl: string;
  readonly runDate: string;
}): Promise<WeeklyResult> {
  if (!DATE_RE.test(opts.runDate)) throw new Error(`日期格式应为 YYYY-MM-DD：${opts.runDate}`);
  const { start, end } = weekRange(opts.runDate);
  const [events, { ctx, offerings }] = await Promise.all([
    weekEvents(opts.dataDir, start, end),
    loadArticleData(opts.rootDir, opts.dataDir),
  ]);
  const article = buildWeeklyArticle({ start, end, events, offerings, siteUrl: opts.siteUrl }, ctx);
  return { start, end, article };
}

export async function writeWeeklyPreview(
  outDir: string,
  result: WeeklyResult,
): Promise<string | null> {
  if (!result.article) return null;
  await mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `wechat-weekly-${result.end}.html`);
  await writeFile(file, previewPage(result.article), "utf8");
  return file;
}

export const isMonday = (date: string): boolean => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
