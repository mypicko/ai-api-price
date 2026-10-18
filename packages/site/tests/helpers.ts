import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSiteData, type SiteData } from "../src/lib/load-data";
import { buildSiteModel, type SiteModel } from "../src/lib/site-model";

export const SITE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const REPO_ROOT = join(SITE_ROOT, "..", "..");
export const FIXTURE_DIR = join(SITE_ROOT, "tests", "fixtures", "data");
export const PROVIDERS_FILE = join(REPO_ROOT, "config", "providers.yaml");
export const NOW = "2026-10-18T00:04:12Z";

let cachedData: SiteData | null = null;

export function fixtureData(): SiteData {
  cachedData ??= loadSiteData({ dataDir: FIXTURE_DIR, providersFile: PROVIDERS_FILE });
  return cachedData;
}

export function fixtureModel(): SiteModel {
  return buildSiteModel(fixtureData(), NOW);
}
