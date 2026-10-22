/**
 * 运行报告：推送用的 DailyReport + GitHub Actions job summary（Markdown）。
 */
import type {
  ChangeEvent,
  MediaOffering,
  MediaUnit,
  Offering,
  QuarantineEntry,
  StatusFile,
  Warning,
} from "@aipb/shared";
import { buildReportText } from "../notify/format";
import type { DailyReport } from "../notify/types";

export const MAX_SUMMARY_WARNINGS = 50;

/** 推送到飞书「待复核」的提醒码：W 级别本来不推送，这两类需要人去核对官网 */
const REMINDER_CODES: ReadonlySet<string> = new Set(["W2004", "W2005"]);

export interface ReportInput {
  readonly today: string;
  readonly status: StatusFile;
  /** 本次实际运行的源 */
  readonly ranSourceIds: ReadonlySet<string>;
  readonly events: readonly ChangeEvent[];
  readonly newlyQuarantined: readonly QuarantineEntry[];
  readonly offerings: readonly Offering[];
  /** 视频/图像线的结果；没有时报告里不出现这一节 */
  readonly media?: {
    readonly offerings: readonly MediaOffering[];
    readonly events: readonly ChangeEvent[];
    readonly units: Readonly<Record<string, MediaUnit>>;
  };
  readonly siteUrl: string;
}

export function buildDailyReport(input: ReportInput): DailyReport {
  const named = [...(input.media?.offerings ?? []), ...input.offerings];
  const names = Object.fromEntries(named.map((o) => [o.id, o.displayName] as const));
  return {
    date: input.today,
    run: input.status.run,
    sources: input.status.sources.filter((s) => input.ranSourceIds.has(s.id)),
    changes: input.events,
    mediaChanges: input.media?.events ?? [],
    mediaUnits: input.media?.units ?? {},
    quarantined: input.newlyQuarantined,
    errors: input.status.warnings
      .filter((w) => w.code.startsWith("E"))
      .map((w) => ({
        code: w.code,
        message: w.message,
        ...(w.sourceId === null ? {} : { sourceId: w.sourceId }),
      })),
    reminders: input.status.warnings
      .filter((w) => REMINDER_CODES.has(w.code))
      .map((w) => ({ code: w.code, message: w.message })),
    siteUrl: input.siteUrl,
    names,
  };
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function sourcesTable(report: DailyReport): readonly string[] {
  const rows = report.sources.map((s) => {
    const icon = s.status === "ok" ? "✅" : s.status === "rejected" ? "⛔" : "❌";
    const error = s.errorCode ? `${s.errorCode} ${cell(s.errorMessage ?? "")}` : "";
    return `| ${s.id} | ${icon} ${s.status} | ${s.offeringCount} | ${(s.durationMs / 1000).toFixed(1)}s | ${s.consecutiveFailures} | ${error} |`;
  });
  return ["| 源 | 状态 | 条数 | 耗时 | 连续失败 | 错误 |", "|---|---|---|---|---|---|", ...rows];
}

function warningsTable(warnings: readonly Warning[]): readonly string[] {
  if (warnings.length === 0) return [];
  const rows = warnings
    .slice(0, MAX_SUMMARY_WARNINGS)
    .map(
      (w) =>
        `| ${w.code} | ${w.sourceId ?? ""} | ${cell(w.offeringId ?? "")} | ${cell(w.message)} |`,
    );
  const more =
    warnings.length > MAX_SUMMARY_WARNINGS
      ? [`\n…另有 ${warnings.length - MAX_SUMMARY_WARNINGS} 条`]
      : [];
  return [
    `### 警告（${warnings.length}）`,
    "",
    "| 码 | 源 | Offering | 说明 |",
    "|---|---|---|---|",
    ...rows,
    ...more,
    "",
  ];
}

export interface SummaryInput {
  readonly report: DailyReport;
  readonly status: StatusFile;
  readonly offerings: readonly Offering[];
  readonly mediaOfferings?: readonly MediaOffering[];
  readonly written: readonly string[];
  readonly latestUnchanged: boolean;
  readonly dryRun: boolean;
}

export function buildSummaryMarkdown(input: SummaryInput): string {
  const { report, status, offerings } = input;
  const count = (s: Offering["status"]): number => offerings.filter((o) => o.status === s).length;
  const stale = offerings.filter((o) => o.stale && o.status !== "removed").length;
  const media = input.mediaOfferings ?? [];
  const mediaLive = (kind: MediaOffering["kind"]): number =>
    media.filter((o) => o.kind === kind && o.status !== "removed").length;
  const icon =
    status.run.result === "success" ? "🟢" : status.run.result === "partial" ? "🟡" : "🔴";
  const text = buildReportText(report);
  const persistLine = input.dryRun
    ? "DRY RUN：没有写入 data/，没有推送"
    : `写入 ${input.written.length} 个文件${input.latestUnchanged ? "；latest.json 内容未变化，未重写" : ""}`;
  return [
    `## ${text.title}`,
    "",
    `${icon} **${status.run.result}** · 耗时 ${(status.run.durationMs / 1000).toFixed(1)}s · ` +
      `Offering：在售 ${count("active")} / 待确认下架 ${count("missing")} / 已下架 ${count("removed")} / 过期 ${stale}`,
    "",
    `视频/图像：视频 ${mediaLive("video")} / 图像 ${mediaLive("image")}`,
    "",
    ...sourcesTable(report),
    "",
    ...text.lines.slice(1).map((line) => `- ${line}`),
    "",
    ...warningsTable(status.warnings),
    persistLine,
    "",
  ].join("\n");
}
