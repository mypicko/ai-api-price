/**
 * Telegram Bot：sendMessage（HTML 格式，内容统一转义）。响应 {"ok":true} 才算成功。
 * 错误信息里不带 Bot Token（S2）。
 */
import type { TelegramConfig } from "../config";
import { isPipelineError, PipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import { buildReportText, escapeHtml } from "./format";
import type { DailyReport, Notifier } from "./types";

export function buildTelegramText(report: DailyReport): string {
  const text = buildReportText(report);
  const body = text.lines.map(escapeHtml).join("\n");
  return `<b>${escapeHtml(text.title)}</b>\n${body}\n🔗 ${escapeHtml(text.link)}`;
}

export interface TelegramNotifierDeps {
  readonly config: TelegramConfig;
  readonly http: HttpClient;
}

function isOk(text: string): boolean {
  try {
    const body: unknown = JSON.parse(text);
    return (
      typeof body === "object" && body !== null && (body as Record<string, unknown>).ok === true
    );
  } catch {
    return false;
  }
}

export function createTelegramNotifier(deps: TelegramNotifierDeps): Notifier {
  const url = `https://api.telegram.org/bot${deps.config.botToken}/sendMessage`;
  return {
    id: "telegram",
    isConfigured: (config) => config.telegram !== null,
    async send(report) {
      const payload = {
        chat_id: deps.config.chatId,
        text: buildTelegramText(report),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      };
      let response: { status: number; text: string };
      try {
        response = await deps.http.post(url, payload);
      } catch (error) {
        const code = isPipelineError(error) ? error.code : "E1001";
        throw new PipelineError("E5001", `Telegram 推送失败（${code}）`, { cause: error });
      }
      if (!isOk(response.text))
        throw new PipelineError("E5001", `Telegram 推送失败：HTTP ${response.status}`);
    },
  };
}
