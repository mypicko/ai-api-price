/**
 * 构建时读取 data/ 和 config/providers.yaml，并用 shared 里的 schema 校验。
 * 文件不存在时使用空数据（网站显示空状态）；文件存在但内容不合法时直接报错，阻止发布错误数据。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ChangesMonthFileSchema,
  FxFileSchema,
  HistoryFileSchema,
  LatestFileSchema,
  ProvidersConfigSchema,
  QuarantineFileSchema,
  StatusFileSchema,
  type ChangesMonthFile,
  type FxFile,
  type HistoryFile,
  type LatestFile,
  type ProvidersConfig,
  type QuarantineFile,
  type StatusFile,
} from "@aipb/shared";
import { DataLoadError, formatIssues, type IssueLike } from "./data-errors";
import { shanghaiDate } from "./i18n";

export interface SiteData {
  readonly latest: LatestFile | null;
  /** key = modelSlug */
  readonly histories: ReadonlyMap<string, HistoryFile>;
  /** 按月份升序 */
  readonly changeMonths: readonly ChangesMonthFile[];
  readonly fx: FxFile;
  readonly status: StatusFile | null;
  readonly quarantine: QuarantineFile;
  readonly providers: ProvidersConfig;
}

export interface LoadOptions {
  readonly dataDir: string;
  readonly providersFile: string;
  /** 没有 fx.json 时使用的汇率（与 pipeline 的 FX_FALLBACK_RATE 一致） */
  readonly fallbackRate?: number;
  /** 没有 fx.json 时 fallback 汇率的日期 */
  readonly today?: string;
}

interface SafeParser<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly IssueLike[] } };
}

export const DEFAULT_FALLBACK_RATE = 7.1;

/** 从 cwd 向上找 pnpm-workspace.yaml 所在目录 */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

export function resolveLoadOptions(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): LoadOptions {
  const root = findRepoRoot(cwd);
  const rate = Number(env["FX_FALLBACK_RATE"]);
  return {
    dataDir: env["DATA_DIR"] ? resolve(cwd, env["DATA_DIR"]) : join(root, "data"),
    providersFile: env["PROVIDERS_FILE"]
      ? resolve(cwd, env["PROVIDERS_FILE"])
      : join(root, "config", "providers.yaml"),
    fallbackRate: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_FALLBACK_RATE,
  };
}

function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new DataLoadError(file, `  - JSON 解析失败：${(error as Error).message}`, {
      cause: error,
    });
  }
}

export function parseWith<T>(schema: SafeParser<T>, input: unknown, file: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new DataLoadError(file, formatIssues(result.error.issues));
}

function readOptional<T>(schema: SafeParser<T>, file: string): T | null {
  if (!existsSync(file)) return null;
  return parseWith(schema, readJson(file), file);
}

function listFiles(dir: string, pattern: RegExp): readonly string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .toSorted()
    .map((name) => join(dir, name));
}

function loadHistories(dataDir: string): ReadonlyMap<string, HistoryFile> {
  const historyDir = join(dataDir, "history");
  const vendorDirs = listFiles(historyDir, /^[a-z0-9][a-z0-9.-]*$/).filter((p) =>
    statSync(p).isDirectory(),
  );
  const files = vendorDirs.flatMap((vendorDir) => listFiles(vendorDir, /\.json$/));
  const entries = files.map((file) => {
    const history = parseWith(HistoryFileSchema, readJson(file), file);
    return [history.modelSlug, history] as const;
  });
  return new Map(entries);
}

function loadChangeMonths(dataDir: string): readonly ChangesMonthFile[] {
  return listFiles(join(dataDir, "changes"), /^\d{4}-\d{2}\.json$/)
    .map((file) => parseWith(ChangesMonthFileSchema, readJson(file), file))
    .toSorted((a, b) => a.month.localeCompare(b.month));
}

export function fallbackFx(rate: number, date: string): FxFile {
  return { latest: { date, usdCny: rate, provider: "fallback" }, lastSuccessAt: null, history: [] };
}

export function loadProviders(file: string): ProvidersConfig {
  if (!existsSync(file))
    throw new DataLoadError(file, "  - 找不到厂商配置文件（可以用 PROVIDERS_FILE 指定）");
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) return parseWith(ProvidersConfigSchema, readJson(file), file);
  return parseWith(ProvidersConfigSchema, parseYaml(text), file);
}

export function loadSiteData(options: LoadOptions): SiteData {
  const { dataDir } = options;
  const latest = readOptional(LatestFileSchema, join(dataDir, "latest.json"));
  const today = options.today ?? latest?.dataDate ?? shanghaiDate(new Date().toISOString());
  const fx =
    readOptional(FxFileSchema, join(dataDir, "fx.json")) ??
    fallbackFx(options.fallbackRate ?? DEFAULT_FALLBACK_RATE, today);
  const status = readOptional(StatusFileSchema, join(dataDir, "status.json"));
  const quarantine = readOptional(QuarantineFileSchema, join(dataDir, "quarantine.json")) ?? {
    entries: status?.quarantine ?? [],
  };
  return {
    latest,
    histories: loadHistories(dataDir),
    changeMonths: loadChangeMonths(dataDir),
    fx,
    status,
    quarantine,
    providers: loadProviders(options.providersFile),
  };
}
