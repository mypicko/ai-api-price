import type { PlatformConfig, RawOffering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import { OPENROUTER_URL } from "../../src/sources/openrouter";
import {
  endpointsUrl,
  openrouterEndpointsSource,
  parseEndpoints,
} from "../../src/sources/openrouter-endpoints";
import { createPlatformMatcher } from "../../src/sources/litellm-resellers";
import { createFakeHttp, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const platform = (id: string, matchers: string[]): PlatformConfig => ({
  id,
  nameZh: id,
  nameEn: id,
  website: `https://${id}.example.com`,
  category: "inference",
  matchers,
  allowedSourceDomains: [`${id}.example.com`, "openrouter.ai"],
});
const PLATFORMS = [platform("deepinfra", ["DeepInfra"]), platform("baseten", ["BaseTen"])];

const ep = (provider: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  provider_name: provider,
  pricing: { prompt, completion: "0.0000006", input_cache_read: "0.00000001" },
  context_length: 1048576,
  max_completion_tokens: 8192,
  ...extra,
});

describe("openrouter-endpoints", () => {
  it("每个服务商一条：只收已配置的服务商，同一服务商多个端点取最便宜，跳过负价", () => {
    const raws = parseEndpoints(
      {
        data: {
          name: "DeepSeek: DeepSeek V4 Flash",
          endpoints: [
            ep("DeepInfra", "0.00000006", { quantization: "fp8" }),
            ep("BaseTen", "0.00000013"),
            ep("BaseTen", "0.00000011"),
            ep("DeepSeek", "0.00000014"),
            ep("Relace", "0.0000000065"),
            ep("DeepInfra", "-1"),
          ],
        },
      },
      {
        modelId: "deepseek/deepseek-v4-flash",
        vendorHint: "deepseek",
        matchPlatform: createPlatformMatcher(PLATFORMS),
      },
    );
    expect(raws.map((r) => [r.platform, r.input])).toEqual([
      ["deepinfra", 0.00000006],
      ["baseten", 0.00000011],
    ]);
    expect(raws[0]).toMatchObject({
      vendorHint: "deepseek",
      modelName: "deepseek-v4-flash",
      displayName: "DeepSeek V4 Flash",
      unit: "per_token",
      currency: "USD",
      contextWindow: 1048576,
      maxOutput: 8192,
      sourceUrl: "https://openrouter.ai/deepseek/deepseek-v4-flash/providers",
    });
    expect(raws[0]?.notes).toContain("fp8");
  });

  it("逐个模型请求：跳过 :free 变体和未知厂商，单个模型失败不影响其他", async () => {
    const http = createFakeHttp({
      [OPENROUTER_URL]: JSON.stringify({
        data: [
          { id: "deepseek/deepseek-v4-flash", name: "DeepSeek: V4 Flash" },
          { id: "deepseek/deepseek-v4-flash:free", name: "free" },
          { id: "deepseek/deepseek-broken", name: "broken" },
          { id: "unknown/model", name: "x" },
        ],
      }),
      [endpointsUrl("deepseek/deepseek-v4-flash")]: JSON.stringify({
        data: { name: "DeepSeek: V4 Flash", endpoints: [ep("DeepInfra", "0.00000006")] },
      }),
      [endpointsUrl("deepseek/deepseek-broken")]: new PipelineError("E1001", "HTTP 404"),
    });
    const raws = (await openrouterEndpointsSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    })) as readonly RawOffering[];
    expect(raws.map((r) => [r.platform, r.modelName])).toEqual([
      ["deepinfra", "deepseek-v4-flash"],
    ]);
    expect(http.requests.map((r) => r.url)).not.toContain(endpointsUrl("unknown/model"));
    expect(http.requests.map((r) => r.url).some((u) => u.includes(":free"))).toBe(false);
  });

  it("全部模型都失败时报 E2001", async () => {
    const http = createFakeHttp({
      [OPENROUTER_URL]: JSON.stringify({ data: [{ id: "deepseek/x", name: "x" }] }),
      [endpointsUrl("deepseek/x")]: new PipelineError("E1001", "HTTP 500"),
    });
    await expect(
      openrouterEndpointsSource.fetch({
        http,
        browser: noopBrowser,
        logger: silentLogger,
        now: NOW,
        rootDir: ROOT_DIR,
      }),
    ).rejects.toMatchObject({ code: "E2001" });
  });
});
