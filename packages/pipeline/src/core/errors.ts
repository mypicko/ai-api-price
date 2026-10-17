/** 错误码对照表（DEV_DOCUMENT §9） */
export const ERROR_CODES = {
  E0001: "环境变量格式错误",
  W0002: "推送渠道配置不完整",
  E1001: "HTTP 请求失败",
  E1002: "请求超时",
  E1003: "疑似被反爬拦截",
  E1004: "Playwright 启动失败",
  E1005: "数据源连续失败",
  E2001: "页面结构变化，找不到价格数据",
  E2002: "汇率长期获取失败，使用兜底汇率",
  W2001: "当日汇率获取失败，沿用上次汇率",
  W2003: "单位或币种无法识别，已跳过",
  E3001: "数据结构不符合 schema",
  E3002: "价格超出合理范围",
  W3003: "价格突变，已进入隔离区",
  E3004: "模型数骤降，整个源被拒绝",
  W3007: "官方价与 OpenRouter 价差过大",
  E4001: "写入数据失败",
  E4002: "网站构建失败",
  E5001: "推送失败",
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface PipelineErrorOptions {
  readonly sourceId?: string;
  readonly cause?: unknown;
  /** 是否值得重试（网络抖动、5xx） */
  readonly retryable?: boolean;
}

export class PipelineError extends Error {
  readonly code: ErrorCode;
  readonly sourceId: string | undefined;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: PipelineErrorOptions = {}) {
    super(`[${code}] ${message}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PipelineError";
    this.code = code;
    this.sourceId = options.sourceId;
    this.retryable = options.retryable ?? false;
  }
}

export function isPipelineError(error: unknown): error is PipelineError {
  return error instanceof PipelineError;
}

/** 把任意错误转成 PipelineError，未知错误归为 fallbackCode */
export function toPipelineError(
  error: unknown,
  fallbackCode: ErrorCode,
  sourceId?: string,
): PipelineError {
  if (isPipelineError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PipelineError(fallbackCode, message, {
    cause: error,
    ...(sourceId === undefined ? {} : { sourceId }),
  });
}
