/**
 * 公众号文章的上下文：厂商 / 平台中文名取自 providers.yaml，新模型的价格取自 latest.json，汇率取自 fx.json。
 */
import path from "node:path";
import { FxFileSchema, LatestFileSchema, type Offering, type ProvidersConfig } from "@aipb/shared";
import { loadProviders } from "../config-files";
import { readJsonFile } from "../steps/state";
import type { ArticleContext } from "./wechat-article";

export function createArticleContext(
  providers: ProvidersConfig,
  offerings: readonly Offering[],
  usdCny: number | null,
): ArticleContext {
  const vendors = new Map(providers.vendors.map((v) => [v.id, v.nameZh]));
  const platforms = new Map(providers.platforms.map((p) => [p.id, p.nameZh]));
  const byId = new Map(offerings.map((o) => [o.id, o]));
  return {
    usdCny,
    vendorName: (id) => vendors.get(id) ?? id,
    platformName: (id) => platforms.get(id) ?? id,
    priceOf: (offeringId) => {
      const o = byId.get(offeringId);
      return o ? { input: o.input, output: o.output, currency: o.currency } : null;
    },
  };
}

export async function loadArticleContext(
  rootDir: string,
  dataDir: string,
): Promise<ArticleContext> {
  const [providers, latest, fx] = await Promise.all([
    loadProviders(rootDir),
    readJsonFile(path.join(dataDir, "latest.json"), LatestFileSchema),
    readJsonFile(path.join(dataDir, "fx.json"), FxFileSchema),
  ]);
  return createArticleContext(providers, latest?.offerings ?? [], fx?.latest.usdCny ?? null);
}
