/**
 * 推送入口：根据配置创建渠道，逐个发送。推送失败只记 E5001，不影响流程（DEV §3.9）。
 */
import type { Warning } from "@aipb/shared";
import type { AppConfig } from "../config";
import { toPipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";
import { makeWarning } from "../steps/types";
import { createEmailNotifier, type MailTransport } from "./email";
import { createFeishuNotifier } from "./feishu";
import { createTelegramNotifier } from "./telegram";
import type { DailyReport, Notifier } from "./types";

export { buildReportText, shouldNotify } from "./format";
export type { DailyReport, Notifier } from "./types";

export interface NotifierDeps {
  readonly http: HttpClient;
  readonly now: () => Date;
  readonly mailTransport?: MailTransport;
}

/** 飞书排第一：默认且主要的渠道 */
export function createNotifiers(config: AppConfig, deps: NotifierDeps): readonly Notifier[] {
  return [
    config.feishu
      ? createFeishuNotifier({ config: config.feishu, http: deps.http, now: deps.now })
      : null,
    config.telegram ? createTelegramNotifier({ config: config.telegram, http: deps.http }) : null,
    config.email
      ? createEmailNotifier({
          config: config.email,
          ...(deps.mailTransport ? { transport: deps.mailTransport } : {}),
        })
      : null,
  ].filter((n): n is Notifier => n !== null);
}

export interface SendResult {
  readonly sent: readonly string[];
  readonly warnings: readonly Warning[];
}

export async function sendReport(
  notifiers: readonly Notifier[],
  report: DailyReport,
  logger: Logger,
): Promise<SendResult> {
  const results = await Promise.all(
    notifiers.map(async (notifier) => {
      try {
        await notifier.send(report);
        logger.info("推送成功", { channel: notifier.id });
        return { id: notifier.id, warning: null };
      } catch (error) {
        const err = toPipelineError(error, "E5001");
        logger.error("推送失败", { channel: notifier.id, code: "E5001", error: err.message });
        return { id: notifier.id, warning: makeWarning("E5001", `${notifier.id}：${err.message}`) };
      }
    }),
  );
  return {
    sent: results.filter((r) => r.warning === null).map((r) => r.id),
    warnings: results.flatMap((r) => (r.warning ? [r.warning] : [])),
  };
}
