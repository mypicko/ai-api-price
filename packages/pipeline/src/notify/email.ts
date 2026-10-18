/**
 * 邮件推送（nodemailer，SMTP）。465 端口使用 TLS。
 */
import nodemailer from "nodemailer";
import type { EmailConfig } from "../config";
import { PipelineError } from "../core/errors";
import { buildReportText, escapeHtml } from "./format";
import type { DailyReport, Notifier } from "./types";

export interface MailMessage {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export function buildEmail(report: DailyReport, config: EmailConfig): MailMessage {
  const text = buildReportText(report);
  const items = text.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  const link = escapeHtml(text.link);
  return {
    from: config.user,
    to: config.to,
    subject: text.title,
    text: [...text.lines, `🔗 ${text.link}`].join("\n"),
    html: `<h2>${escapeHtml(text.title)}</h2>\n${items}\n<p><a href="${link}">${link}</a></p>`,
  };
}

export function createSmtpTransport(config: EmailConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
}

export interface EmailNotifierDeps {
  readonly config: EmailConfig;
  readonly transport?: MailTransport;
}

export function createEmailNotifier(deps: EmailNotifierDeps): Notifier {
  return {
    id: "email",
    isConfigured: (config) => config.email !== null,
    async send(report) {
      const transport = deps.transport ?? createSmtpTransport(deps.config);
      try {
        await transport.sendMail(buildEmail(report, deps.config));
      } catch (error) {
        throw new PipelineError("E5001", "邮件推送失败", { cause: error });
      }
    },
  };
}
