import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { loadProviders } from "../../src/config-files";
import { silentLogger } from "../../src/core/logger";
import {
  fetchModelsDevMetadata,
  MODELSDEV_URL,
  modelsdevCnSource,
  modelsdevSiliconflowCnSource,
  parseModelsDev,
  parseModelsDevMetadata,
  toTiers,
} from "../../src/sources/modelsdev";
import { resolveMetadata } from "../../src/steps/metadata";
import { createAliasResolver, createVendorMatcher } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const FIXTURE = path.join(FIXTURES_DIR, "modelsdev/2026-10-18-1.json");
const loadFixture = async (): Promise<unknown> => JSON.parse(await readFile(FIXTURE, "utf8"));
const allKnown = { isKnownVendor: () => true, logger: silentLogger };

describe("source/modelsdev 解析", () => {
  it("official-cn：只收国内站厂商的文本模型，跳过缺价格、已弃用和语音模型", async () => {
    const offerings = parseModelsDev(await loadFixture(), "official-cn", allKnown);
    const names = offerings.map((o) => `${o.vendorHint}/${o.modelName}`);
    expect(names).toContain("moonshot/kimi-k3");
    expect(names).toContain("minimax/MiniMax-M3");
    expect(names).toContain("stepfun/step-3.5-flash");
    expect(names).not.toContain("minimax/minimax-no-cost");
    expect(names).not.toContain("minimax/minimax-old");
    expect(names.some((n) => n.startsWith("stepfun/step-tts") || n.includes("asr"))).toBe(false);
    // alibaba-cn 与 aliyun 抓取器（北京地域价）重复，不收；国际站和其他厂商也不在这个平台里
    expect(names.some((n) => n.startsWith("alibaba/"))).toBe(false);
    expect(names.some((n) => n.startsWith("openai/"))).toBe(false);
    expect(offerings).toHaveLength(4 + 2 + 1);
    for (const o of offerings) expect(RawOfferingSchema.safeParse(o).success).toBe(true);
  });

  it("价格单位是 USD / 每百万 token，并标注换算说明和官方文档链接", async () => {
    const offerings = parseModelsDev(await loadFixture(), "official-cn", allKnown);
    const kimi = offerings.find((o) => o.modelName === "kimi-k3");
    expect(kimi).toMatchObject({
      currency: "USD",
      unit: "per_1m",
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3,
      contextWindow: 1048576,
      displayName: expect.any(String),
      sourceUrl: "https://platform.moonshot.cn/docs/api/chat",
    });
    expect(kimi?.notes).toMatch(/models\.dev/);
    expect(kimi?.notes).toMatch(/以官网为准/);
  });

  it("按上下文分档的价格转成 tiers", async () => {
    const offerings = parseModelsDev(await loadFixture(), "official-cn", allKnown);
    // 分档输入顺序打乱，验证会按 size 排序
    const tiers = toTiers({ input: 0.029, output: 0.287 }, [
      { input: 0.172, output: 1.72, tier: { type: "context", size: 256000 } },
      { input: 0.115, output: 1.147, tier: { type: "context", size: 128000 } },
    ]);
    expect(tiers).toEqual([
      {
        minInputTokens: 0,
        maxInputTokens: 128000,
        input: 0.029,
        output: 0.287,
        cacheRead: null,
        cacheWrite: null,
      },
      {
        minInputTokens: 128000,
        maxInputTokens: 256000,
        input: 0.115,
        output: 1.147,
        cacheRead: null,
        cacheWrite: null,
      },
      {
        minInputTokens: 256000,
        maxInputTokens: null,
        input: 0.172,
        output: 1.72,
        cacheRead: null,
        cacheWrite: null,
      },
    ]);
    const m3 = offerings.find((o) => o.modelName === "MiniMax-M3");
    expect(m3?.tiers?.at(-1)).toMatchObject({
      minInputTokens: 512000,
      input: 0.6,
      cacheRead: 0.12,
    });
    expect(offerings.find((o) => o.modelName === "MiniMax-M2.7")?.tiers).toBeUndefined();
  });

  it("toTiers 忽略非 context 类型的分档", () => {
    const base = { input: 1, output: 2 };
    expect(
      toTiers(base, [{ input: 3, output: 4, tier: { type: "time", size: 5 } }]),
    ).toBeUndefined();
    expect(toTiers(base, undefined)).toBeUndefined();
  });

  it("siliconflow-cn：厂商取自模型 ID 前缀，未知厂商丢弃，免费模型保留", async () => {
    const known = new Set(["bytedance-seed", "tencent", "qwen"]);
    const offerings = parseModelsDev(await loadFixture(), "siliconflow-cn", {
      isKnownVendor: (v) => known.has(v.toLowerCase()),
      logger: silentLogger,
    });
    expect(offerings.map((o) => [o.vendorHint, o.modelName])).toContainEqual([
      "Qwen",
      "Qwen3.5-27B",
    ]);
    expect(offerings.some((o) => o.vendorHint === "unknownorg")).toBe(false);
    expect(offerings).toHaveLength(6);
    const free = offerings.find((o) => o.modelName === "Qwen3.5-4B");
    expect(free).toMatchObject({ input: 0, output: 0 });
    expect(offerings[0]?.sourceUrl).toBe("https://cloud.siliconflow.com/models");
  });

  it("响应格式不对时抛 E2001", () => {
    expect(() => parseModelsDev("nope", "official-cn", allKnown)).toThrow(/E2001/);
    expect(() => parseModelsDev([], "official-cn", allKnown)).toThrow(/E2001/);
  });
});

describe("source/modelsdev 抓取", () => {
  const ctx = { browser: noopBrowser, logger: silentLogger, now: NOW, rootDir: ROOT_DIR };

  it("两个源共用一次下载；用真实 providers.yaml 匹配厂商", async () => {
    const http = createFakeHttp({ [MODELSDEV_URL]: await readFile(FIXTURE, "utf8") });
    const cn = await modelsdevCnSource.fetch({ ...ctx, http });
    const sf = await modelsdevSiliconflowCnSource.fetch({ ...ctx, http });
    expect(http.requests.filter((r) => r.url === MODELSDEV_URL)).toHaveLength(1);
    expect(cn.length).toBe(7);
    expect(sf.map((o) => o.vendorHint)).not.toContain("unknownorg");
    expect(sf.length).toBe(6);
    expect(modelsdevCnSource.platform).toBe("official-cn");
    expect(modelsdevSiliconflowCnSource.platform).toBe("siliconflow-cn");
  });

  it("没有解析出任何报价时抛 E2001", async () => {
    const http = createFakeHttp({ [MODELSDEV_URL]: '{"openai":{"id":"openai","models":{}}}' });
    await expect(modelsdevCnSource.fetch({ ...ctx, http })).rejects.toMatchObject({
      code: "E2001",
    });
  });
});

describe("source/modelsdev 元数据（只借名称和上下文，不收价格）", () => {
  it("从 alibaba-cn 解析名称、上下文和最大输出，跳过语音和已弃用模型", async () => {
    const meta = parseModelsDevMetadata(await loadFixture());
    expect(meta.every((m) => m.vendorHint === "alibaba")).toBe(true);
    expect(meta.find((m) => m.modelName === "qwen-flash")).toEqual({
      vendorHint: "alibaba",
      modelName: "qwen-flash",
      displayName: "Qwen Flash",
      contextWindow: 1000000,
      maxOutput: 32768,
    });
    expect(parseModelsDevMetadata("nope")).toEqual([]);
  });

  it("下载失败时返回空数组，不抛错", async () => {
    const http = createFakeHttp({});
    await expect(fetchModelsDevMetadata(http, silentLogger)).resolves.toEqual([]);
  });

  it("映射到规范 modelSlug，未知厂商丢弃", async () => {
    const providers = await loadProviders(ROOT_DIR);
    const meta = resolveMetadata(
      [
        {
          vendorHint: "alibaba",
          modelName: "Qwen3-Coder-Plus",
          displayName: "Qwen3 Coder Plus",
          contextWindow: 1000000,
          maxOutput: null,
        },
        {
          vendorHint: "nobody",
          modelName: "x",
          displayName: null,
          contextWindow: null,
          maxOutput: null,
        },
      ],
      createVendorMatcher(providers),
      createAliasResolver({}),
    );
    expect(meta).toEqual([
      {
        modelSlug: "alibaba/qwen3-coder-plus",
        displayName: "Qwen3 Coder Plus",
        contextWindow: 1000000,
        maxOutput: null,
      },
    ]);
  });
});
