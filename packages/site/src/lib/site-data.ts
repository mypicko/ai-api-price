/**
 * 构建时的数据单例：每次构建只读取、校验一次 data/。
 * DATA_DIR 覆盖数据目录，PROVIDERS_FILE 覆盖厂商配置。
 */
import { buildSiteModel, type SiteModel } from "./site-model";
import { loadSiteData, resolveLoadOptions } from "./load-data";

let cached: SiteModel | null = null;

export function getSiteModel(): SiteModel {
  cached ??= buildSiteModel(loadSiteData(resolveLoadOptions(process.env, process.cwd())));
  return cached;
}

/** 测试用 */
export function resetSiteModel(): void {
  cached = null;
}
