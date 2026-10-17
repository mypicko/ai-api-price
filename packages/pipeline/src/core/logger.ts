/**
 * 结构化 JSON 行日志（STYLE §1.5），内置脱敏。
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const REDACT_PATTERNS: readonly RegExp[] = [
  /(open-apis\/bot\/v2\/hook\/)[\w-]+/g,
  /(api\.telegram\.org\/bot)[^/\s]+/g,
  /(\b\d{6,}:)[\w-]{20,}/g,
];

export function redact(text: string): string {
  return REDACT_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "$1***"), text);
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly bindings?: Record<string, unknown>;
  /** 测试时可注入 */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const bindings = options.bindings ?? {};
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const log = (lvl: LogLevel, msg: string, ctx: Record<string, unknown> = {}): void => {
    if (LEVEL_ORDER[lvl] < LEVEL_ORDER[level]) return;
    const entry = { level: lvl, ts: now().toISOString(), msg, ...bindings, ...ctx };
    write(redact(JSON.stringify(entry, errorReplacer)));
  };

  return {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
    child: (extra) => createLogger({ ...options, bindings: { ...bindings, ...extra } }),
  };
}

function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  return value;
}

/** 测试用：丢弃所有日志 */
export const silentLogger: Logger = createLogger({ write: () => undefined });
