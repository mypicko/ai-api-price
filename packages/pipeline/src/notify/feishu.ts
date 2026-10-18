/**
 * 飞书群机器人（默认推送渠道）：interactive 卡片消息。
 * 开启签名校验时：sign = base64(HMAC-SHA256(key = `${timestamp}\n${secret}`, msg = ""))，timestamp 为秒。
 * 返回 {"code":0} 才算成功，其他情况抛 E5001。错误信息里不带 Webhook URL（S2）。
 */
import { createHmac } from "node:crypto";
import type { FeishuConfig } from "../config";
import { isPipelineError, PipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import { redact } from "../core/logger";
import { buildReportText, escapeHtml } from "./format";
import type { DailyReport, Notifier } from "./types";

export function feishuSign(timestamp: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

function headerTemplate(report: DailyReport): "red" | "orange" | "blue" {
  if (report.run.result === "failed") return "red";
  const hasErrors =
    report.run.result === "partial" || report.errors.some((e) => e.code.startsWith("E"));
  return hasErrors || report.quarantined.length > 0 ? "orange" : "blue";
}

export function buildFeishuCard(report: DailyReport): Record<string, unknown> {
  const text = buildReportText(report);
  return {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: text.title }, template: headerTemplate(report) },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: text.lines.map(escapeHtml).join("\n") } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "查看全部变动" },
            url: text.link,
            type: "primary",
          },
        ],
      },
    ],
  };
}

export function buildFeishuPayload(
  report: DailyReport,
  secret: string | null,
  now: Date,
): Record<string, unknown> {
  const base = { msg_type: "interactive", card: buildFeishuCard(report) };
  if (secret === null) return base;
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  return { timestamp, sign: feishuSign(timestamp, secret), ...base };
}

function parseFeishuResponse(text: string): { readonly ok: boolean; readonly detail: string } {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) return { ok: false, detail: "响应不是对象" };
    const record = body as Record<string, unknown>;
    const code = record.code ?? record.StatusCode;
    const msg = typeof record.msg === "string" ? record.msg : "";
    return { ok: code === 0, detail: `code=${String(code)} ${msg}`.trim() };
  } catch {
    return { ok: false, detail: "响应不是合法 JSON" };
  }
}

export interface FeishuNotifierDeps {
  readonly config: FeishuConfig;
  readonly http: HttpClient;
  readonly now: () => Date;
}

export function createFeishuNotifier(deps: FeishuNotifierDeps): Notifier {
  return {
    id: "feishu",
    isConfigured: (config) => config.feishu !== null,
    async send(report) {
      const payload = buildFeishuPayload(report, deps.config.secret, deps.now());
      let response: { status: number; text: string };
      try {
        response = await deps.http.post(deps.config.webhookUrl, payload);
      } catch (error) {
        const code = isPipelineError(error) ? error.code : "E1001";
        throw new PipelineError("E5001", `飞书推送失败（${code}）`, { cause: error });
      }
      const parsed = parseFeishuResponse(response.text);
      if (response.status < 200 || response.status >= 300 || !parsed.ok) {
        throw new PipelineError(
          "E5001",
          redact(`飞书推送失败：HTTP ${response.status} ${parsed.detail}`),
        );
      }
    },
  };
}
