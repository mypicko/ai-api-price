/**
 * 手动兜底价格：读取 config/manual/*.yaml（ManualSourceConfigSchema，API 文档 §3.4）。
 * - 目录为空或不存在时返回空数组，也算成功（manual 源不适用 V5）
 * - 文件格式错误时抛 E3001（整个源 failed，沿用旧数据）
 * - verifiedAt 超过 14 天的警告由管线在 status.json 中给出（见 steps/manual-freshness.ts）
 * - 按文件的 platform 分流成两个源：official → manual，official-cn（国内站人民币原价）→ manual-cn；
 *   其他平台的文件跳过并记录日志
 */
import type { RawOffering } from "@aipb/shared";
import { loadManualConfigs, type ManualConfigFile } from "../config-files";
import type { Logger } from "../core/logger";
import type { Source } from "./types";

/** 手动配置支持的平台 → 对应的源 ID */
const MANUAL_SOURCES = { official: "manual", "official-cn": "manual-cn" } as const;
type ManualPlatform = keyof typeof MANUAL_SOURCES;

function isManualPlatform(platform: string): platform is ManualPlatform {
  return Object.hasOwn(MANUAL_SOURCES, platform);
}

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
    ...(m.tiers === undefined ? {} : { tiers: m.tiers }),
  }));
}

export function collectManualOfferings(
  files: readonly ManualConfigFile[],
  logger: Logger,
  platform: ManualPlatform = "official",
): RawOffering[] {
  return files.flatMap((file) => {
    if (file.config.platform === platform) return manualToRaw(file);
    // 不支持的平台只由 manual（official）源报一次，避免重复日志
    if (platform === "official" && !isManualPlatform(file.config.platform)) {
      logger.warn("manual：只支持 official 和 official-cn 平台，已跳过", {
        sourceId: "manual",
        file: file.file,
        platform: file.config.platform,
      });
    }
    return [];
  });
}

function createManualSource(platform: ManualPlatform): Source {
  const id = MANUAL_SOURCES[platform];
  return {
    id,
    platform,
    kind: "manual",
    timeoutMs: 5000,
    async fetch(ctx) {
      const files = await loadManualConfigs(ctx.rootDir);
      const offerings = collectManualOfferings(files, ctx.logger, platform);
      ctx.logger.info("manual 读取完成", {
        sourceId: id,
        files: files.length,
        count: offerings.length,
      });
      return offerings;
    },
  };
}

export const manualSource: Source = createManualSource("official");
/** 国内站人民币原价（人工核对），优先级高于 models.dev 社区数据 */
export const manualCnSource: Source = createManualSource("official-cn");
