/**
 * 手动兜底价格：读取 config/manual/*.yaml（ManualSourceConfigSchema，API 文档 §3.4）。
 * - 目录为空或不存在时返回空数组，也算成功（manual 源不适用 V5）
 * - 文件格式错误时抛 E3001（整个源 failed，沿用旧数据）
 * - verifiedAt 超过 14 天的警告由管线在 status.json 中给出（见 steps/manual-freshness.ts）
 * - 目前只支持 platform = official（Source.platform），其他平台的文件会被跳过并记录日志
 */
import type { RawOffering } from "@aipb/shared";
import { loadManualConfigs, type ManualConfigFile } from "../config-files";
import type { Logger } from "../core/logger";
import type { Source } from "./types";

const MANUAL_PLATFORM = "official";

export function manualToRaw(file: ManualConfigFile): RawOffering[] {
  const { config } = file;
  return config.models.map((m) => ({
    vendorHint: config.vendor,
    modelName: m.model,
    ...(m.displayName === undefined ? {} : { displayName: m.displayName }),
    currency: config.currency,
    unit: config.unit,
    input: m.input,
    output: m.output,
    ...(m.cacheRead === undefined ? {} : { cacheRead: m.cacheRead }),
    ...(m.cacheWrite === undefined ? {} : { cacheWrite: m.cacheWrite }),
    contextWindow: m.contextWindow ?? null,
    maxOutput: m.maxOutput ?? null,
    sourceUrl: config.sourceUrl,
    ...(m.notes === undefined ? {} : { notes: m.notes }),
  }));
}

export function collectManualOfferings(
  files: readonly ManualConfigFile[],
  logger: Logger,
): RawOffering[] {
  return files.flatMap((file) => {
    if (file.config.platform !== MANUAL_PLATFORM) {
      logger.warn("manual：暂不支持 official 以外的平台，已跳过", {
        sourceId: "manual",
        file: file.file,
        platform: file.config.platform,
      });
      return [];
    }
    return manualToRaw(file);
  });
}

export const manualSource: Source = {
  id: "manual",
  platform: MANUAL_PLATFORM,
  kind: "manual",
  timeoutMs: 5000,
  async fetch(ctx) {
    const files = await loadManualConfigs(ctx.rootDir);
    const offerings = collectManualOfferings(files, ctx.logger);
    ctx.logger.info("manual 读取完成", {
      sourceId: "manual",
      files: files.length,
      count: offerings.length,
    });
    return offerings;
  },
};
