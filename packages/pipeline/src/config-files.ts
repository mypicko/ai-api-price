/**
 * 读取并校验 config/ 下的 YAML 配置（API 文档 §3.4）。
 * 配置文件格式错误属于启动错误：抛 PipelineError("E3001")，CLI 以退出码 1 结束。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  AliasesConfigSchema,
  ManualSourceConfigSchema,
  OverridesConfigSchema,
  ProvidersConfigSchema,
  type AliasesConfig,
  type ManualSourceConfig,
  type Override,
  type ProvidersConfig,
} from "@aipb/shared";
import { parse } from "yaml";
import type { z } from "zod";
import { PipelineError } from "./core/errors";

export interface ManualConfigFile {
  readonly file: string;
  readonly config: ManualSourceConfig;
}

export interface ConfigFiles {
  readonly providers: ProvidersConfig;
  readonly aliases: AliasesConfig;
  readonly overrides: readonly Override[];
  readonly manual: readonly ManualConfigFile[];
}

export function configDir(rootDir: string): string {
  return path.join(rootDir, "config");
}

async function readOptionalText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw new PipelineError("E3001", `读取配置失败：${file}`, { cause: error });
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** 解析 YAML 文本并用 schema 校验；空文件按 emptyValue 处理 */
export function parseYamlConfig<T>(
  text: string,
  schema: z.ZodType<T>,
  label: string,
  emptyValue: unknown,
): T {
  let data: unknown;
  try {
    data = parse(text) ?? emptyValue;
  } catch (error) {
    throw new PipelineError("E3001", `${label} 不是合法 YAML`, { cause: error });
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new PipelineError("E3001", `${label} 格式错误：${detail}`);
  }
  return result.data;
}

async function loadYaml<T>(file: string, schema: z.ZodType<T>, emptyValue: unknown): Promise<T> {
  const text = await readOptionalText(file);
  return parseYamlConfig(text ?? "", schema, path.basename(file), emptyValue);
}

export async function loadProviders(rootDir: string): Promise<ProvidersConfig> {
  const file = path.join(configDir(rootDir), "providers.yaml");
  const text = await readOptionalText(file);
  if (text === null) throw new PipelineError("E3001", `缺少配置文件：${file}`);
  const providers = parseYamlConfig(text, ProvidersConfigSchema, "providers.yaml", null);
  assertUniqueIds(
    providers.vendors.map((v) => v.id),
    "vendors",
  );
  assertUniqueIds(
    providers.platforms.map((p) => p.id),
    "platforms",
  );
  return providers;
}

function assertUniqueIds(ids: readonly string[], label: string): void {
  const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicated.length > 0) {
    throw new PipelineError(
      "E3001",
      `providers.yaml 的 ${label} 有重复 id：${duplicated.join(", ")}`,
    );
  }
}

export async function loadAliases(rootDir: string): Promise<AliasesConfig> {
  return loadYaml(path.join(configDir(rootDir), "aliases.yaml"), AliasesConfigSchema, {});
}

export async function loadOverrides(rootDir: string): Promise<readonly Override[]> {
  const overrides = await loadYaml(
    path.join(configDir(rootDir), "overrides.yaml"),
    OverridesConfigSchema,
    [],
  );
  const pinWithoutPrice = overrides.find((o) => o.action === "pin" && o.price === undefined);
  if (pinWithoutPrice) {
    throw new PipelineError(
      "E3001",
      `overrides.yaml：${pinWithoutPrice.offering} 的 pin 必须填写 price`,
    );
  }
  return overrides;
}

/** 读取 config/manual/*.yaml；目录不存在时返回空数组 */
export async function loadManualConfigs(rootDir: string): Promise<readonly ManualConfigFile[]> {
  const dir = path.join(configDir(rootDir), "manual");
  let names: readonly string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw new PipelineError("E3001", `读取目录失败：${dir}`, { cause: error });
  }
  const yamlNames = names.filter((n) => /\.ya?ml$/i.test(n)).toSorted();
  return Promise.all(
    yamlNames.map(async (name) => ({
      file: name,
      config: await loadYaml(path.join(dir, name), ManualSourceConfigSchema, null),
    })),
  );
}

export async function loadConfigFiles(rootDir: string): Promise<ConfigFiles> {
  const [providers, aliases, overrides, manual] = await Promise.all([
    loadProviders(rootDir),
    loadAliases(rootDir),
    loadOverrides(rootDir),
    loadManualConfigs(rootDir),
  ]);
  return { providers, aliases, overrides, manual };
}
