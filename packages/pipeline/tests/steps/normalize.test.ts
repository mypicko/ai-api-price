import type { RawOffering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  createAliasResolver,
  createVendorMatcher,
  hostMatches,
  isAllowedSourceUrl,
  isForeignModel,
  normalizeOfferings,
  normalizeOne,
  sanitizeRaw,
  sourcePriority,
  truncate,
  type NormalizeContext,
} from "../../src/steps/normalize";
import { TEST_PROVIDERS } from "../helpers";

function officialPlatform() {
  const platform = TEST_PROVIDERS.platforms[0];
  if (!platform) throw new Error("fixture");
  return platform;
}

function raw(overrides: Partial<RawOffering> = {}): RawOffering {
  return {
    vendorHint: "OpenAI",
    modelName: "GPT-4o",
    currency: "USD",
    unit: "per_token",
    input: 0.0000025,
    output: 0.00001,
    sourceUrl: "https://openai.com/api/pricing/",
    ...overrides,
  };
}

function ctx(aliases: Record<string, string[]> = {}): NormalizeContext {
  return {
    sourceId: "litellm",
    platform: officialPlatform(),
    matchVendor: createVendorMatcher(TEST_PROVIDERS),
    resolveAlias: createAliasResolver(aliases),
  };
}

describe("normalize", () => {
  it("把每 token 价格换算成每百万 token，保留原币种", () => {
    const result = normalizeOne(raw({ cacheRead: 0.00000125 }), ctx());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.candidate).toMatchObject({
      id: "official:openai/gpt-4o",
      vendor: "openai",
      model: "gpt-4o",
      modelSlug: "openai/gpt-4o",
      displayName: "GPT-4o",
      platform: "official",
      source: "litellm",
      currency: "USD",
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
      cacheWrite: null,
      tiers: null,
      contextWindow: null,
      modalities: ["text"],
      notes: null,
    });
  });

  it("per_1k / per_1m 单位换算", () => {
    const k = normalizeOne(
      raw({ unit: "per_1k", input: 0.002, output: 0.006, currency: "CNY" }),
      ctx(),
    );
    const m = normalizeOne(raw({ unit: "per_1m", input: 2, output: 8 }), ctx());
    expect(
      k.kind === "ok" && [k.candidate.input, k.candidate.output, k.candidate.currency],
    ).toEqual([2, 6, "CNY"]);
    expect(m.kind === "ok" && [m.candidate.input, m.candidate.output]).toEqual([2, 8]);
  });

  it("vendorHint 按 matchers 匹配（不区分大小写、支持 xxx/ 前缀、中文名）", () => {
    const match = createVendorMatcher(TEST_PROVIDERS);
    expect(match("OPENAI")?.id).toBe("openai");
    expect(match("deepseek/deepseek-chat")?.id).toBe("deepseek");
    expect(match("深度求索")?.id).toBe("deepseek");
    expect(match("openai-compatible")).toBeNull();
  });

  it("未知厂商返回 unknown-vendor，由调用方汇总", () => {
    const result = normalizeOfferings(
      [raw({ vendorHint: "foo" }), raw({ vendorHint: "foo" }), raw()],
      ctx(),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.unknownVendors).toEqual(["foo"]);
  });

  it("aliases.yaml 合并别名（原始名、规范化名、带 vendor 前缀）", () => {
    const resolve = createAliasResolver({
      "deepseek/deepseek-chat": ["DeepSeek-V3", "deepseek/deepseek-chat-v3", "深度求索-对话"],
    });
    expect(resolve("deepseek", "deepseek-v3")).toBe("deepseek-chat");
    expect(resolve("deepseek", "DeepSeek V3")).toBe("deepseek-chat");
    expect(resolve("deepseek", "DeepSeek V4")).toBe("deepseek-v4");
    expect(resolve("deepseek", "deepseek-chat-v3")).toBe("deepseek-chat");
    expect(resolve("deepseek", "深度求索-对话")).toBe("deepseek-chat");
    // 别名只对同一个厂商生效
    expect(resolve("openai", "deepseek-v3")).toBe("deepseek-v3");
  });

  it("模型名规范化后为空时丢弃并记 E3001", () => {
    const result = normalizeOne(raw({ modelName: "通义千问" }), ctx());
    expect(result.kind === "invalid" && result.warning.code).toBe("E3001");
  });

  it("S8：sourceUrl 域名不在 vendor/platform 白名单内时丢弃", () => {
    const bad = normalizeOne(raw({ sourceUrl: "https://evil-openai.com/x" }), ctx());
    expect(bad.kind === "invalid" && bad.warning.message).toMatch(/白名单/);
    const sub = normalizeOne(raw({ sourceUrl: "https://platform.openai.com/docs" }), ctx());
    expect(sub.kind).toBe("ok");
    const platformDomain = normalizeOne(
      raw({ sourceUrl: "https://raw.githubusercontent.com/x" }),
      ctx(),
    );
    expect(platformDomain.kind).toBe("ok");
  });

  it("hostMatches / isAllowedSourceUrl", () => {
    expect(hostMatches("a.openai.com", "openai.com")).toBe(true);
    expect(hostMatches("openai.com.evil.io", "openai.com")).toBe(false);
    expect(isAllowedSourceUrl("http://openai.com", ["openai.com"])).toBe(false);
    expect(isAllowedSourceUrl("not a url", ["openai.com"])).toBe(false);
  });

  it("S6：notes 截到 200 字符，名称截到 100 字符", () => {
    const long = "长".repeat(300);
    const cleaned = sanitizeRaw(
      raw({ notes: long, displayName: long, modelName: `m${"x".repeat(150)}` }),
    ) as RawOffering;
    expect(Array.from(cleaned.notes ?? "")).toHaveLength(200);
    expect(Array.from(cleaned.displayName ?? "")).toHaveLength(100);
    expect(cleaned.modelName).toHaveLength(100);
    expect(sanitizeRaw(null)).toBeNull();
    expect(sanitizeRaw([1])).toEqual([1]);
    expect(truncate("😀😀😀", 2)).toBe("😀😀");
  });

  it("有阶梯价时按 minInputTokens 升序，顶层价格 = 第一档", () => {
    const result = normalizeOne(
      raw({
        unit: "per_1m",
        input: 9,
        output: 9,
        cacheRead: 0.5,
        tiers: [
          { minInputTokens: 200000, maxInputTokens: null, input: 2.5, output: 15 },
          { minInputTokens: 0, maxInputTokens: 200000, input: 1.25, output: 10 },
        ],
      }),
      ctx(),
    );
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.candidate.tiers?.map((t) => t.minInputTokens)).toEqual([0, 200000]);
    expect(result.candidate).toMatchObject({ input: 1.25, output: 10, cacheRead: 0.5 });
    expect(result.candidate.tiers?.[1]).toEqual({
      minInputTokens: 200000,
      maxInputTokens: null,
      input: 2.5,
      output: 15,
      cacheRead: null,
      cacheWrite: null,
    });
  });

  it("同一源内重复的 Offering ID 只保留第一条", () => {
    const result = normalizeOfferings(
      [raw({ input: 0.000001 }), raw({ modelName: "gpt 4o", input: 0.000002 })],
      ctx(),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.input).toBe(1);
  });

  it("来源优先级：厂商官网 > litellm > manual", () => {
    expect(sourcePriority("deepseek")).toBeGreaterThan(sourcePriority("litellm"));
    expect(sourcePriority("litellm")).toBeGreaterThan(sourcePriority("manual"));
    // 国内站：人工核对的价格优先于 models.dev 社区数据
    expect(sourcePriority("manual-cn")).toBeGreaterThan(sourcePriority("modelsdev-cn"));
  });
});

describe("isForeignModel", () => {
  it("识别厂商平台转售的别家模型", () => {
    expect(isForeignModel("mistral", "glm-5.2")).toBe(true);
    expect(isForeignModel("mistral", "zai-glm-5")).toBe(true);
    expect(isForeignModel("zhipu", "glm-5.2")).toBe(false);
    expect(isForeignModel("deepseek", "deepseek-chat")).toBe(false);
    expect(isForeignModel("openai", "gpt-4o")).toBe(false);
    expect(isForeignModel("alibaba", "minimax-m2.5")).toBe(true);
    expect(isForeignModel("alibaba", "moonshot-kimi-k2-instruct")).toBe(true);
    expect(isForeignModel("minimax", "minimax-m3")).toBe(false);
  });

  it("normalizeOne 丢弃转售模型", () => {
    const result = normalizeOne(raw({ vendorHint: "OpenAI", modelName: "glm-5-2" }), ctx());
    expect(result.kind).toBe("unknown-vendor");
  });
});
