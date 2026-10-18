import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SourceItem } from "../../src/sources/types";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import {
  buildTiers,
  LITELLM_URL,
  litellmSource,
  parseLitellm,
  stripProviderPrefix,
} from "../../src/sources/litellm";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const FIXTURE = path.join(FIXTURES_DIR, "litellm/2026-10-18-1.json");
const loadFixture = async (): Promise<unknown> => JSON.parse(await readFile(FIXTURE, "utf8"));
const options = {
  today: "2026-10-18",
  pricingUrlFor: (hint: string) => (hint === "minimax" ? null : `https://${hint}.example/pricing`),
};
const find = <T extends SourceItem>(list: readonly T[], vendorHint: string, modelName: string) =>
  list.find((o) => o.vendorHint === vendorHint && o.modelName === modelName);

describe("source/litellm", () => {
  it("只保留厂商直连的 chat / responses 条目", async () => {
    const offerings = parseLitellm(await loadFixture(), options);
    const names = offerings.map((o) => `${o.vendorHint}:${o.modelName}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "openai:gpt-4o",
        "anthropic:claude-sonnet-4-5",
        "gemini:gemini-2.5-pro",
        "mistral:codestral-latest",
        "cohere:command-a-03-2025",
        "openai:gpt-5.2-pro",
      ]),
    );
    // 排除：sample_spec、fine-tune、embedding、转售方（bedrock/azure/openrouter/tencent）、已弃用
    expect(names.some((n) => n.includes("ft:"))).toBe(false);
    expect(names).not.toContain("openai:text-embedding-3-small");
    expect(names).not.toContain("openai:computer-use-preview");
    expect(names).not.toContain("openai:gpt-5-codex");
    expect(names).not.toContain("deepseek:deepseek-chat");
    expect(
      offerings.every((o) => !["bedrock", "azure", "openrouter", "tencent"].includes(o.vendorHint)),
    ).toBe(true);
    expect(offerings).toHaveLength(14);
  });

  it("价格单位为 per_token、USD，模型名去掉 provider 前缀", async () => {
    const offerings = parseLitellm(await loadFixture(), options);
    const gpt = find(offerings, "openai", "gpt-4o");
    expect(gpt).toMatchObject({
      currency: "USD",
      unit: "per_token",
      input: 0.0000025,
      output: 0.00001,
      cacheRead: 0.00000125,
    });
    expect(gpt?.contextWindow).toBe(128000);
    expect(gpt?.maxOutput).toBe(16384);
    const claude = find(offerings, "anthropic", "claude-sonnet-4-5");
    expect(claude).toMatchObject({
      input: 0.000003,
      output: 0.000015,
      cacheRead: 3e-7,
      cacheWrite: 0.00000375,
      contextWindow: 200000,
    });
    // 没有任何价格字段的条目跳过
    expect(find(offerings, "meta", "Llama-3.3-70B-Instruct")).toBeUndefined();
    expect(find(offerings, "amazon", "nova-pro-v1")).toBeDefined();
  });

  it("sourceUrl 用厂商定价页，为 null 时用 LiteLLM 的 raw URL", async () => {
    const offerings = parseLitellm(await loadFixture(), options);
    expect(find(offerings, "openai", "gpt-4o")?.sourceUrl).toBe("https://openai.example/pricing");
    expect(find(offerings, "minimax", "MiniMax-M2.5")?.sourceUrl).toBe(LITELLM_URL);
  });

  it("*_above_200k_tokens 转成阶梯价", async () => {
    const gemini = find(parseLitellm(await loadFixture(), options), "gemini", "gemini-2.5-pro");
    expect(gemini?.tiers).toEqual([
      {
        minInputTokens: 0,
        maxInputTokens: 200000,
        input: 0.00000125,
        output: 0.00001,
        cacheRead: 1.25e-7,
        cacheWrite: null,
      },
      {
        minInputTokens: 200000,
        maxInputTokens: null,
        input: 0.0000025,
        output: 0.000015,
        cacheRead: 2.5e-7,
        cacheWrite: null,
      },
    ]);
  });

  it("多个阈值按升序排列；没有阈值时不生成阶梯", () => {
    const entry = {
      litellm_provider: "openai",
      mode: "chat",
      input_cost_per_token: 1,
      input_cost_per_token_above_272k_tokens: 3,
      input_cost_per_token_above_128k_tokens: 2,
      cache_creation_input_token_cost_above_1hr: 9,
    };
    expect(buildTiers(entry)?.map((t) => [t.minInputTokens, t.maxInputTokens, t.input])).toEqual([
      [0, 128000, 1],
      [128000, 272000, 2],
      [272000, null, 3],
    ]);
    expect(
      buildTiers({ litellm_provider: "openai", mode: "chat", input_cost_per_token: 1 }),
    ).toBeUndefined();
  });

  it("同名模型（带不带前缀）只保留第一条", async () => {
    const offerings = parseLitellm(await loadFixture(), options);
    expect(
      offerings.filter((o) => o.vendorHint === "deepseek" && o.modelName === "deepseek-v4-pro"),
    ).toHaveLength(1);
  });

  it("stripProviderPrefix", () => {
    expect(stripProviderPrefix("gemini/gemini-2.5-pro")).toBe("gemini-2.5-pro");
    expect(stripProviderPrefix("gpt-4o")).toBe("gpt-4o");
  });

  it("响应不是对象时抛 E2001", () => {
    expect(() => parseLitellm([], options)).toThrow(/E2001/);
    expect(() => parseLitellm(null, options)).toThrow(/E2001/);
  });

  it("fetch：用 providers.yaml 的 pricingUrl，解析出 0 条时抛 E2001", async () => {
    const ctx = { browser: noopBrowser, logger: silentLogger, now: NOW, rootDir: ROOT_DIR };
    const http = createFakeHttp({ [LITELLM_URL]: await readFile(FIXTURE, "utf8") });
    const offerings = await litellmSource.fetch({ ...ctx, http });
    expect(find(offerings, "anthropic", "claude-sonnet-4-5")?.sourceUrl).toBe(
      "https://www.anthropic.com/pricing",
    );
    expect(find(offerings, "gemini", "gemini-2.5-pro")?.sourceUrl).toBe(
      "https://ai.google.dev/gemini-api/docs/pricing",
    );
    expect(offerings.some((o) => "media" in o)).toBe(false);
    const empty = createFakeHttp({ [LITELLM_URL]: "{}" });
    await expect(litellmSource.fetch({ ...ctx, http: empty })).rejects.toMatchObject({
      code: "E2001",
    });
  });

  it("fetch：视频/图像条目与文本报价一起返回，证据链接用条目自带的官方 source", async () => {
    const ctx = { browser: noopBrowser, logger: silentLogger, now: NOW, rootDir: ROOT_DIR };
    const text = JSON.parse(await readFile(FIXTURE, "utf8")) as Record<string, unknown>;
    const media = JSON.parse(
      await readFile(path.join(FIXTURES_DIR, "litellm/2026-10-18-media.json"), "utf8"),
    ) as Record<string, unknown>;
    const http = createFakeHttp({ [LITELLM_URL]: JSON.stringify({ ...text, ...media }) });
    const items = await litellmSource.fetch({ ...ctx, http });
    const h3 = find(items, "minimax", "MiniMax-H3");
    expect(h3 && "media" in h3 ? h3.media : null).toEqual({ kind: "video", unit: "per_second" });
    expect(h3?.sourceUrl).toBe("https://platform.minimax.io/docs/guides/pricing-paygo");
    expect(items.filter((o) => !("media" in o))).toHaveLength(14);
  });
});
