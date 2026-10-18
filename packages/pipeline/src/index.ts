/**
 * CLI 入口（API 文档 §3.3）。在仓库根目录执行：pnpm pipeline <命令>
 *   run [--dry-run] [--only a,b] [--no-notify]
 *   snapshot <sourceId>
 *   notify:test
 *   validate
 *   quarantine:list
 * 退出码见 DEV_DOCUMENT §9.1。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Warning } from "@aipb/shared";
import { loadConfig, type AppConfig } from "./config";
import { createBrowserClient, type BrowserClient } from "./core/browser";
import { isPipelineError } from "./core/errors";
import { createHttpClient, type HttpClient } from "./core/http";
import { createLogger, type Logger } from "./core/logger";
import { createNotifiers } from "./notify";
import { ALL_SOURCES } from "./sources/registry";
import { runPipeline } from "./steps/run";
import { parseRunFlags } from "./tools/cli-args";
import { runNotifyTest } from "./tools/notify-test";
import { formatQuarantine, loadQuarantine } from "./tools/quarantine-list";
import { runSnapshot } from "./tools/snapshot";
import { validateDataDir } from "./tools/validate-data";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const FIXTURES_DIR = path.join(ROOT_DIR, "packages/pipeline/tests/fixtures");

const USAGE = `用法：pnpm pipeline <命令>
  run [--dry-run] [--only a,b] [--no-notify]   完整运行一次管线
  snapshot <sourceId>                          保存数据源原文到 tests/fixtures/<sourceId>/
  notify:test                                  给所有已配置的渠道发测试消息
  validate                                     用 schema 校验 data/ 下的全部文件
  quarantine:list                              列出隔离区条目
`;

function out(text: string): void {
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function loadDotEnv(): void {
  const file = path.join(ROOT_DIR, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

interface Runtime {
  readonly config: AppConfig;
  readonly configWarnings: readonly Warning[];
  readonly logger: Logger;
  readonly http: HttpClient;
  readonly browser: BrowserClient;
}

function createRuntime(): Runtime {
  loadDotEnv();
  const { config, warnings } = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  warnings.forEach((w) => logger.warn(w.message, { code: w.code }));
  const userAgent = `AIPriceBoardBot/1.0 (+${config.siteUrl}/about)`;
  return {
    config,
    configWarnings: warnings,
    logger,
    http: createHttpClient({ userAgent }),
    browser: createBrowserClient({ userAgent }),
  };
}

function selectedSources(
  only: readonly string[] | null,
  config: AppConfig,
): ReadonlySet<string> | null {
  const list = only ?? config.sourcesEnabled;
  if (list === null || list.length === 0) return null;
  const known = new Set(ALL_SOURCES.map((s) => s.id));
  const unknown = list.filter((id) => !known.has(id));
  if (unknown.length > 0)
    throw new Error(`未知的数据源：${unknown.join(", ")}（可选：${[...known].join(", ")}）`);
  return new Set(list);
}

async function commandRun(args: readonly string[], rt: Runtime): Promise<number> {
  const flags = parseRunFlags(args);
  const result = await runPipeline({
    rootDir: ROOT_DIR,
    dataDir: DATA_DIR,
    sources: ALL_SOURCES,
    selected: selectedSources(flags.only, rt.config),
    config: rt.config,
    configWarnings: rt.configWarnings,
    http: rt.http,
    browser: rt.browser,
    logger: rt.logger,
    clock: () => new Date(),
    dryRun: flags.dryRun || rt.config.dryRun,
    notify: flags.notify,
    notifiers: createNotifiers(rt.config, { http: rt.http, now: () => new Date() }),
  });
  out(result.summary);
  return result.exitCode;
}

async function commandSnapshot(args: readonly string[], rt: Runtime): Promise<number> {
  const source = ALL_SOURCES.find((s) => s.id === args[0]);
  if (!source)
    throw new Error(
      `用法：pnpm pipeline snapshot <sourceId>（可选：${ALL_SOURCES.map((s) => s.id).join(", ")}）`,
    );
  const result = await runSnapshot({
    source,
    ctx: {
      http: rt.http,
      browser: rt.browser,
      logger: rt.logger,
      now: new Date(),
      rootDir: ROOT_DIR,
    },
    fixturesRoot: FIXTURES_DIR,
  });
  result.files.forEach((f) => out(`已保存：${path.relative(ROOT_DIR, f)}`));
  if (result.error) {
    out(`解析失败：${result.error.message}`);
    return 1;
  }
  out(`解析出 ${result.offeringCount} 条报价`);
  return 0;
}

async function commandNotifyTest(rt: Runtime): Promise<number> {
  const notifiers = createNotifiers(rt.config, { http: rt.http, now: () => new Date() });
  if (notifiers.length === 0) {
    out("没有已配置的推送渠道（FEISHU_WEBHOOK_URL / TELEGRAM_* / SMTP_*）");
    return 1;
  }
  const result = await runNotifyTest(notifiers, new Date(), rt.config.siteUrl, rt.logger);
  result.sent.forEach((id) => out(`✅ ${id}`));
  result.warnings.forEach((w) => out(`❌ ${w.message}`));
  return result.warnings.length === 0 ? 0 : 1;
}

async function commandValidate(): Promise<number> {
  const checks = await validateDataDir(DATA_DIR);
  checks.forEach((c) => out(`${c.ok ? "✅" : "❌"} ${c.file}${c.error ? `：${c.error}` : ""}`));
  const failed = checks.filter((c) => !c.ok).length;
  out(`共 ${checks.length} 个文件，${failed} 个不合法`);
  return failed === 0 ? 0 : 1;
}

async function dispatch(command: string | undefined, args: readonly string[]): Promise<number> {
  if (command === undefined || command === "help" || command === "--help") {
    out(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command === "validate") return commandValidate();
  if (command === "quarantine:list") {
    out(formatQuarantine(await loadQuarantine(DATA_DIR)));
    return 0;
  }
  const rt = createRuntime();
  try {
    if (command === "run") return await commandRun(args, rt);
    if (command === "snapshot") return await commandSnapshot(args, rt);
    if (command === "notify:test") return await commandNotifyTest(rt);
    out(`未知命令：${command}\n${USAGE}`);
    return 1;
  } finally {
    await rt.browser.close();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  try {
    process.exitCode = await dispatch(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = isPipelineError(error) ? error.code : "E0001";
    createLogger().error(message, { code });
    process.exitCode = 1;
  }
}

await main();
