/**
 * `wechat:preview [YYYY-MM-DD]`：用 data/ 里某一天的变动生成公众号文章，写成本地 HTML 预览
 * （手机宽度，带标题和摘要），不调用公众号接口。日期缺省为本月最近一次有变动的日子。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml } from "../notify/format";
import type { DailyReport } from "../notify/types";
import { buildWechatArticle, type WechatArticle } from "../notify/wechat-article";
import { loadArticleContext } from "../notify/wechat-context";
import { loadChangesMonth } from "../steps/state";

export interface PreviewOptions {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly outDir: string;
  readonly siteUrl: string;
  readonly date?: string;
}

export interface PreviewResult {
  readonly date: string;
  readonly file: string | null;
  readonly article: WechatArticle | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 用 data/changes 里某一天的变动拼一份日报（wechat:preview / wechat:draft 共用）。
 * 变动事件 ID 以日期开头：<YYYY-MM-DD>-<offeringId>-<序号>
 */
export async function reportForDate(
  opts: Pick<PreviewOptions, "dataDir" | "siteUrl" | "date">,
): Promise<DailyReport> {
  if (opts.date !== undefined && !DATE_RE.test(opts.date))
    throw new Error(`日期格式应为 YYYY-MM-DD：${opts.date}`);
  const month = (opts.date ?? new Date().toISOString()).slice(0, 7);
  const events = (await loadChangesMonth(opts.dataDir, month))?.events ?? [];
  const date = opts.date ?? events.at(-1)?.id.slice(0, 10) ?? `${month}-01`;
  const now = new Date().toISOString();
  return {
    date,
    run: { id: "preview", startedAt: now, finishedAt: now, durationMs: 0, result: "success" },
    sources: [],
    changes: events.filter((e) => e.id.startsWith(`${date}-`)),
    quarantined: [],
    errors: [],
    siteUrl: opts.siteUrl,
  };
}

function page(article: WechatArticle): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(article.title)}</title></head>
<body style="margin:0;background:#ededed;">
<div style="max-width:420px;margin:0 auto;background:#fff;padding:20px 16px 32px;min-height:100vh;box-sizing:border-box;">
<h1 style="font-size:22px;line-height:1.4;margin:0 0 8px;color:#1f2328;">${escapeHtml(article.title)}</h1>
<p style="font-size:13px;color:#8a8f98;margin:0 0 20px;">AI序言 · 摘要：${escapeHtml(article.digest)}</p>
${article.html}
<p style="font-size:14px;color:#576b95;margin:24px 0 0;">阅读原文 → ${escapeHtml(article.contentSourceUrl)}</p>
</div></body></html>`;
}

export async function runWechatPreview(opts: PreviewOptions): Promise<PreviewResult> {
  const [report, ctx] = await Promise.all([
    reportForDate(opts),
    loadArticleContext(opts.rootDir, opts.dataDir),
  ]);
  const article = buildWechatArticle(report, ctx);
  if (!article) return { date: report.date, file: null, article: null };
  await mkdir(opts.outDir, { recursive: true });
  const file = path.join(opts.outDir, `wechat-${report.date}.html`);
  await writeFile(file, page(article), "utf8");
  return { date: report.date, file, article };
}
