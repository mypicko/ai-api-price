/**
 * 日报文字内容（DEV_DOCUMENT §3.9 模板），飞书 / Telegram / 邮件共用。
 * 输出纯文本行，各渠道自行转义。
 */
import {
  formatPct,
  formatPrice,
  type ChangeEvent,
  type ChangeField,
  type QuarantineEntry,
} from "@aipb/shared";
import type { DailyReport } from "./types";

export const MAX_ITEMS_PER_SECTION = 5;

const PLATFORM_LABEL: Readonly<Record<string, string>> = {
  official: "官方",
  openrouter: "OpenRouter",
  siliconflow: "硅基流动",
};
const FIELD_LABEL: Readonly<Record<ChangeField["field"], string>> = {
  input: "输入",
  output: "输出",
  cacheRead: "缓存读",
  cacheWrite: "缓存写",
  contextWindow: "上下文",
};

export interface ReportText {
  readonly title: string;
  readonly lines: readonly string[];
  readonly link: string;
}

function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

function describeField(field: ChangeField, currency: ChangeEvent["currency"]): string {
  const label = FIELD_LABEL[field.field];
  const fmt = (v: number | null): string =>
    field.field === "contextWindow" ? String(v ?? "—") : formatPrice(v, currency);
  return `${label} ${fmt(field.old)}→${fmt(field.new)}（${formatPct(field.pct)}）`;
}

function describeEvent(event: ChangeEvent): string {
  const name = `${event.displayName}（${platformLabel(event.platform)}）`;
  const fields = event.fields.map((f) => describeField(f, event.currency)).join("，");
  const confirmed = event.confirmedFromQuarantine ? " [隔离后确认]" : "";
  return fields === "" ? name : `${name} ${fields}${confirmed}`;
}

function section(icon: string, label: string, items: readonly string[]): string | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_ITEMS_PER_SECTION).join("；");
  const more = items.length > MAX_ITEMS_PER_SECTION ? ` 等 ${items.length} 条` : "";
  return `${icon} ${label} ${items.length}：${shown}${more}`;
}

function describeQuarantine(
  entry: QuarantineEntry,
  names: Readonly<Record<string, string>>,
): string {
  const name = names[entry.offeringId] ?? entry.offeringId;
  const fields = entry.fields.map((f) => `${FIELD_LABEL[f.field]} ${formatPct(f.pct)}`).join("，");
  return `${name} ${fields}（下次抓到同一值后自动发布）`;
}

function statusLine(report: DailyReport): string {
  const total = report.sources.length;
  const ok = report.sources.filter((s) => s.status === "ok").length;
  const failed = report.sources
    .filter((s) => s.status !== "ok")
    .map((s) => `${s.id}（${s.errorCode ?? s.status}）`);
  const head = `${ok === total ? "✅" : "⚠️"} 成功 ${ok}/${total} 个源`;
  return failed.length === 0 ? head : `${head}  失败：${failed.join("、")}`;
}

function eventsOf(report: DailyReport, type: ChangeEvent["type"]): readonly string[] {
  return report.changes.filter((e) => e.type === type).map(describeEvent);
}

export function buildReportText(report: DailyReport): ReportText {
  const failedKeys = new Set(report.sources.map((s) => `${s.id}|${s.errorCode ?? ""}`));
  const errors = report.errors
    .filter((e) => !failedKeys.has(`${e.sourceId ?? ""}|${e.code}`))
    .map((e) => `${e.code}${e.sourceId ? ` ${e.sourceId}` : ""} ${e.message}`);
  const names = report.names ?? {};
  const link = `${report.siteUrl}/changes`;
  const lines = [
    statusLine(report),
    section("🔻", "降价", eventsOf(report, "price_down")),
    section("🔺", "涨价", eventsOf(report, "price_up")),
    section("🆕", "新模型", eventsOf(report, "new_model")),
    section("⛔", "下架", eventsOf(report, "removed")),
    section("♻️", "重新上架", eventsOf(report, "restored")),
    section(
      "🚧",
      "隔离待确认",
      report.quarantined.map((q) => describeQuarantine(q, names)),
    ),
    section("❗", "告警", errors),
  ].filter((line): line is string => line !== null);
  const hasNews = lines.length > 1;
  return {
    title: `📊 AI API 价格日报 · ${report.date}`,
    lines: hasNews ? lines : [...lines, "今日无价格变动"],
    link,
  };
}

/** 是否值得推送：有变动、有告警、隔离区新增，或 NOTIFY_ON_SUCCESS */
export function shouldNotify(report: DailyReport, notifyOnSuccess: boolean): boolean {
  const notable = report.changes.some((e) =>
    ["price_down", "price_up", "new_model", "removed"].includes(e.type),
  );
  const hasErrors =
    report.errors.some((e) => e.code.startsWith("E")) ||
    report.sources.some((s) => s.status !== "ok");
  return notifyOnSuccess || notable || hasErrors || report.quarantined.length > 0;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
