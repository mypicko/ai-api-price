/**
 * 环境变量解析（DEV_DOCUMENT §7）。
 * - 格式错误：抛 PipelineError("E0001")，CLI 以退出码 1 结束
 * - 推送渠道配置不完整：给出 W0002 警告并禁用该渠道
 */
import type { Warning } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "./core/errors";
import type { LogLevel } from "./core/logger";

export const CHANNEL_IDS = ["feishu", "telegram", "email"] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export interface FeishuConfig {
  readonly webhookUrl: string;
  readonly secret: string | null;
}

export interface TelegramConfig {
  readonly botToken: string;
  readonly chatId: string;
}

export interface EmailConfig {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly to: string;
}

export interface AppConfig {
  /** SITE_URL + BASE_PATH，不带末尾斜杠 */
  readonly siteUrl: string;
  readonly basePath: string;
  readonly notifyOnSuccess: boolean;
  readonly anomalyThreshold: number;
  readonly staleAlertDays: number;
  readonly staleWarnDays: number;
  readonly fxFallbackRate: number;
  readonly sourcesEnabled: readonly string[] | null;
  readonly dryRun: boolean;
  readonly logLevel: LogLevel;
  readonly feishu: FeishuConfig | null;
  readonly telegram: TelegramConfig | null;
  readonly email: EmailConfig | null;
  readonly runId: string | null;
  readonly stepSummaryPath: string | null;
}

export interface ConfigResult {
  readonly config: AppConfig;
  readonly warnings: readonly Warning[];
}

export type EnvLike = Readonly<Record<string, string | undefined>>;

const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" ? (value.trim() === "" ? undefined : value.trim()) : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());
const optionalBool = (fallback: boolean) =>
  z.preprocess(blankToUndefined, z.stringbool().optional()).transform((v) => v ?? fallback);
const positiveNumber = (fallback: number) =>
  z
    .preprocess(blankToUndefined, z.coerce.number().positive().finite().optional())
    .transform((v) => v ?? fallback);
const positiveInt = (fallback: number) =>
  z
    .preprocess(blankToUndefined, z.coerce.number().int().positive().optional())
    .transform((v) => v ?? fallback);
const commaList = z.preprocess(blankToUndefined, z.string().optional()).transform((v) =>
  v === undefined
    ? null
    : v
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
);

const EnvSchema = z.object({
  SITE_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  BASE_PATH: z.preprocess(blankToUndefined, z.string().startsWith("/").optional()),
  NOTIFY_CHANNELS: commaList.pipe(z.array(z.enum(CHANNEL_IDS)).nullable()),
  FEISHU_WEBHOOK_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^https$/ }).optional()),
  FEISHU_WEBHOOK_SECRET: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: positiveInt(465),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  NOTIFY_EMAIL_TO: z.preprocess(blankToUndefined, z.email().optional()),
  NOTIFY_ON_SUCCESS: optionalBool(false),
  ANOMALY_THRESHOLD: positiveNumber(0.8),
  STALE_ALERT_DAYS: positiveInt(3),
  STALE_WARN_DAYS: positiveInt(7),
  FX_FALLBACK_RATE: positiveNumber(7.1),
  SOURCES_ENABLED: commaList,
  DRY_RUN: optionalBool(false),
  LOG_LEVEL: z.preprocess(blankToUndefined, z.enum(["debug", "info", "warn", "error"]).optional()),
  GITHUB_RUN_ID: optionalString,
  GITHUB_STEP_SUMMARY: optionalString,
});
type ParsedEnv = z.infer<typeof EnvSchema>;

const DEFAULT_SITE_URL = "http://localhost:4321";

function channelWarning(channel: ChannelId, message: string): Warning {
  return {
    code: "W0002",
    sourceId: null,
    offeringId: null,
    message: `${channel}：${message}，已禁用该渠道`,
  };
}

/** 只返回字段名，不带取值，避免把 Secrets 打进日志 */
function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

export function joinSiteUrl(siteUrl: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, "");
  return `${siteUrl.replace(/\/+$/, "")}${base}`;
}

interface ChannelResult<T> {
  readonly value: T | null;
  readonly warning: Warning | null;
}

function resolveFeishu(env: ParsedEnv): ChannelResult<FeishuConfig> {
  if (env.FEISHU_WEBHOOK_URL === undefined) {
    const warning =
      env.FEISHU_WEBHOOK_SECRET === undefined
        ? null
        : channelWarning("feishu", "只填了 FEISHU_WEBHOOK_SECRET，缺少 FEISHU_WEBHOOK_URL");
    return { value: null, warning };
  }
  return {
    value: { webhookUrl: env.FEISHU_WEBHOOK_URL, secret: env.FEISHU_WEBHOOK_SECRET ?? null },
    warning: null,
  };
}

function resolveTelegram(env: ParsedEnv): ChannelResult<TelegramConfig> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (token !== undefined && chatId !== undefined)
    return { value: { botToken: token, chatId }, warning: null };
  if (token === undefined && chatId === undefined) return { value: null, warning: null };
  return {
    value: null,
    warning: channelWarning("telegram", "TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 需要同时填写"),
  };
}

function resolveEmail(env: ParsedEnv): ChannelResult<EmailConfig> {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass, NOTIFY_EMAIL_TO: to } = env;
  if (host !== undefined && user !== undefined && pass !== undefined && to !== undefined) {
    return { value: { host, port: env.SMTP_PORT, user, pass, to }, warning: null };
  }
  if ([host, user, pass, to].every((v) => v === undefined)) return { value: null, warning: null };
  return {
    value: null,
    warning: channelWarning(
      "email",
      "SMTP_HOST / SMTP_USER / SMTP_PASS / NOTIFY_EMAIL_TO 需要全部填写",
    ),
  };
}

function applyChannelFilter<T>(
  channel: ChannelId,
  result: ChannelResult<T>,
  allowed: readonly ChannelId[] | null,
): ChannelResult<T> {
  if (allowed === null) return result;
  if (!allowed.includes(channel)) return { value: null, warning: null };
  if (result.value === null && result.warning === null) {
    return {
      value: null,
      warning: channelWarning(channel, "NOTIFY_CHANNELS 中启用了该渠道，但没有填写配置"),
    };
  }
  return result;
}

export function loadConfig(env: EnvLike): ConfigResult {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new PipelineError("E0001", `环境变量格式错误：${formatIssues(parsed.error)}`);
  }
  const e = parsed.data;
  const channels = e.NOTIFY_CHANNELS;
  const feishu = applyChannelFilter("feishu", resolveFeishu(e), channels);
  const telegram = applyChannelFilter("telegram", resolveTelegram(e), channels);
  const email = applyChannelFilter("email", resolveEmail(e), channels);
  const basePath = e.BASE_PATH ?? "/";
  const config: AppConfig = {
    siteUrl: joinSiteUrl(e.SITE_URL ?? DEFAULT_SITE_URL, basePath),
    basePath,
    notifyOnSuccess: e.NOTIFY_ON_SUCCESS,
    anomalyThreshold: e.ANOMALY_THRESHOLD,
    staleAlertDays: e.STALE_ALERT_DAYS,
    staleWarnDays: e.STALE_WARN_DAYS,
    fxFallbackRate: e.FX_FALLBACK_RATE,
    sourcesEnabled: e.SOURCES_ENABLED,
    dryRun: e.DRY_RUN,
    logLevel: e.LOG_LEVEL ?? "info",
    feishu: feishu.value,
    telegram: telegram.value,
    email: email.value,
    runId: e.GITHUB_RUN_ID ?? null,
    stepSummaryPath: e.GITHUB_STEP_SUMMARY ?? null,
  };
  const warnings = [feishu.warning, telegram.warning, email.warning].filter(
    (w): w is Warning => w !== null,
  );
  return { config, warnings };
}
