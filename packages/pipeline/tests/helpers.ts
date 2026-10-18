/**
 * 测试辅助：构造 Offering / Candidate / 假 HttpClient。禁止真实网络请求。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Offering, ProvidersConfig } from "@aipb/shared";
import type { AppConfig } from "../src/config";
import type { BrowserClient } from "../src/core/browser";
import { PipelineError } from "../src/core/errors";
import type { HttpClient } from "../src/core/http";
import type { Candidate } from "../src/steps/types";

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURES_DIR = path.join(ROOT_DIR, "packages/pipeline/tests/fixtures");

export const NOW = new Date("2026-10-18T00:00:00Z");
export const NOW_ISO = "2026-10-18T00:00:00Z";
export const TODAY = "2026-10-18";

export function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const vendor = overrides.vendor ?? "openai";
  const model = overrides.model ?? "gpt-4o";
  const platform = overrides.platform ?? "official";
  return {
    id: `${platform}:${vendor}/${model}`,
    vendor,
    model,
    modelSlug: `${vendor}/${model}`,
    displayName: model,
    platform,
    source: "litellm",
    currency: "USD",
    input: 2.5,
    output: 10,
    cacheRead: null,
    cacheWrite: null,
    tiers: null,
    contextWindow: 128000,
    maxOutput: 16384,
    modalities: ["text"],
    sourceUrl: "https://openai.com/api/pricing/",
    notes: null,
    ...overrides,
  };
}

export function makeOffering(overrides: Partial<Offering> = {}): Offering {
  const { isFree, stale, status, missingDays, firstSeenAt, fetchedAt, publishedAt, ...rest } =
    overrides;
  return {
    ...makeCandidate(rest),
    isFree: isFree ?? false,
    stale: stale ?? false,
    status: status ?? "active",
    missingDays: missingDays ?? 0,
    firstSeenAt: firstSeenAt ?? "2026-10-01",
    fetchedAt: fetchedAt ?? "2026-10-17T00:00:00Z",
    publishedAt: publishedAt ?? "2026-10-17T00:00:00Z",
  };
}

export const TEST_PROVIDERS: ProvidersConfig = {
  vendors: [
    {
      id: "openai",
      nameZh: "OpenAI",
      nameEn: "OpenAI",
      region: "intl",
      website: "https://openai.com",
      pricingUrl: "https://openai.com/api/pricing/",
      logo: null,
      matchers: ["openai"],
      allowedSourceDomains: ["openai.com"],
    },
    {
      id: "deepseek",
      nameZh: "DeepSeek",
      nameEn: "DeepSeek",
      region: "cn",
      website: "https://www.deepseek.com",
      pricingUrl: null,
      logo: null,
      matchers: ["deepseek", "深度求索"],
      allowedSourceDomains: ["deepseek.com"],
    },
  ],
  platforms: [
    {
      id: "official",
      nameZh: "官方",
      nameEn: "Official",
      website: null,
      allowedSourceDomains: ["githubusercontent.com"],
    },
    {
      id: "openrouter",
      nameZh: "OpenRouter",
      nameEn: "OpenRouter",
      website: "https://openrouter.ai",
      allowedSourceDomains: ["openrouter.ai"],
    },
  ],
};

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    siteUrl: "https://example.github.io/board",
    basePath: "/board/",
    notifyOnSuccess: false,
    anomalyThreshold: 0.8,
    staleAlertDays: 3,
    staleWarnDays: 7,
    fxFallbackRate: 7.1,
    sourcesEnabled: null,
    dryRun: false,
    logLevel: "info",
    feishu: null,
    telegram: null,
    email: null,
    runId: "123",
    stepSummaryPath: null,
    ...overrides,
  };
}

export type Route = string | (() => string | Promise<string>) | PipelineError;

export interface FakeHttp extends HttpClient {
  readonly requests: readonly {
    readonly method: string;
    readonly url: string;
    readonly body?: unknown;
  }[];
}

/** 按 URL 返回预置响应；未配置的 URL 抛 E1001，保证测试里没有真实请求 */
export function createFakeHttp(
  routes: Readonly<Record<string, Route>>,
  postResponse?: (url: string, body: unknown) => { status: number; text: string },
): FakeHttp {
  const requests: { method: string; url: string; body?: unknown }[] = [];
  const resolve = async (url: string): Promise<string> => {
    const route = routes[url];
    if (route === undefined) throw new PipelineError("E1001", `未 mock 的请求：${url}`);
    if (route instanceof PipelineError) throw route;
    return typeof route === "function" ? route() : route;
  };
  return {
    requests,
    async getText(url) {
      requests.push({ method: "GET", url });
      return resolve(url);
    },
    async getJson<T>(url: string): Promise<T> {
      requests.push({ method: "GET", url });
      return JSON.parse(await resolve(url)) as T;
    },
    async post(url, body) {
      requests.push({ method: "POST", url, body });
      if (!postResponse) throw new PipelineError("E1001", `未 mock 的 POST：${url}`);
      return postResponse(url, body);
    },
  };
}

export const noopBrowser: BrowserClient = {
  async render(url) {
    throw new PipelineError("E1004", `测试中不允许启动浏览器：${url}`);
  },
  async close() {
    return undefined;
  },
};
