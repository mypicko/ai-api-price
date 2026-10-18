/**
 * Notifier 推送契约（API 文档 §3.2）。
 */
import type { ChangeEvent, QuarantineEntry, RunSummary, SourceResult } from "@aipb/shared";
import type { AppConfig, ChannelId } from "../config";

export interface ReportError {
  readonly code: string;
  readonly sourceId?: string;
  readonly message: string;
}

export interface DailyReport {
  /** YYYY-MM-DD（北京时间） */
  readonly date: string;
  readonly run: RunSummary;
  readonly sources: readonly SourceResult[];
  /** 本次新增的变动 */
  readonly changes: readonly ChangeEvent[];
  /** 本次新进入隔离区的条目 */
  readonly quarantined: readonly QuarantineEntry[];
  readonly errors: readonly ReportError[];
  readonly siteUrl: string;
  /** offeringId → 展示名（隔离区条目只有 ID） */
  readonly names?: Readonly<Record<string, string>>;
}

export interface Notifier {
  readonly id: ChannelId;
  /** 根据配置判断是否已启用 */
  isConfigured(config: AppConfig): boolean;
  /** 发送日报；失败时抛 PipelineError("E5001") */
  send(report: DailyReport): Promise<void>;
}
