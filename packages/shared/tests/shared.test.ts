import { describe, expect, it } from "vitest";
import {
  blendedPrice,
  convertCurrency,
  formatPct,
  formatPrice,
  formatTokens,
  makeOfferingId,
  normalizeId,
  normalizeModelId,
  OfferingSchema,
  parseOfferingId,
  pctChange,
  priceEquals,
  priceSetEquals,
  roundSig,
  toPerMillion,
} from "../src";

describe("units", () => {
  it("把每 token 价格换算成每百万 token，并消除浮点误差", () => {
    expect(toPerMillion(0.00000015, "per_token")).toBe(0.15);
    expect(toPerMillion(0.002, "per_1k")).toBe(2);
    expect(toPerMillion(8, "per_1m")).toBe(8);
    expect(toPerMillion(null, "per_1m")).toBeNull();
    expect(toPerMillion(undefined, "per_1m")).toBeNull();
  });

  it("roundSig 保留 6 位有效数字，0 原样返回", () => {
    expect(roundSig(0.1 + 0.2)).toBe(0.3);
    expect(roundSig(0)).toBe(0);
  });

  it("币种双向换算", () => {
    expect(convertCurrency(1, "USD", "CNY", 7.1)).toBe(7.1);
    expect(convertCurrency(7.1, "CNY", "USD", 7.1)).toBe(1);
    expect(convertCurrency(3, "USD", "USD", 7.1)).toBe(3);
    expect(convertCurrency(null, "USD", "CNY", 7.1)).toBeNull();
  });

  it("混合价按 3:1 加权", () => {
    expect(blendedPrice(1, 5)).toBe(2);
    expect(blendedPrice(null, 5)).toBeNull();
  });

  it("相对变化", () => {
    expect(pctChange(16, 8)).toBe(-0.5);
    expect(pctChange(0, 8)).toBeNull();
    expect(pctChange(null, 8)).toBeNull();
  });

  it("价格比较容差 0.01%", () => {
    expect(priceEquals(1, 1.000001)).toBe(true);
    expect(priceEquals(1, 1.01)).toBe(false);
    expect(priceEquals(null, null)).toBe(true);
    expect(priceEquals(null, 0)).toBe(false);
    const a = { input: 1, output: 2, cacheRead: null, cacheWrite: null };
    expect(priceSetEquals(a, { ...a })).toBe(true);
    expect(priceSetEquals(a, { ...a, output: 3 })).toBe(false);
  });
});

describe("slug", () => {
  it("规范化模型名", () => {
    expect(normalizeId("Claude Sonnet 4.5")).toBe("claude-sonnet-4.5");
    expect(normalizeId(" qwen_plus ")).toBe("qwen-plus");
    expect(normalizeId("GLM-4.6（新）")).toBe("glm-4.6");
    expect(normalizeId("--a//b--")).toBe("a-b");
  });

  it("模型 ID 统一版本号写法", () => {
    expect(normalizeModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
    expect(normalizeModelId("claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
    expect(normalizeModelId("claude-3-5-sonnet")).toBe("claude-3.5-sonnet");
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4.5-20251001");
    expect(normalizeModelId("llama-3-1-8b")).toBe("llama-3.1-8b");
    expect(normalizeModelId("gpt-4o-2024-08-06")).toBe("gpt-4o-2024-08-06");
    expect(normalizeModelId("qwen-2-72b")).toBe("qwen-2-72b");
    expect(normalizeModelId("GLM-4-6")).toBe("glm-4.6");
  });

  it("生成并解析 Offering ID", () => {
    const id = makeOfferingId("official", "deepseek", "deepseek-chat");
    expect(id).toBe("official:deepseek/deepseek-chat");
    expect(parseOfferingId(id)).toEqual({
      platform: "official",
      vendor: "deepseek",
      model: "deepseek-chat",
    });
    expect(parseOfferingId("bad")).toBeNull();
  });
});

describe("format", () => {
  it("价格分档格式化", () => {
    expect(formatPrice(1200, "CNY")).toBe("¥1,200");
    expect(formatPrice(15, "USD")).toBe("$15.00");
    expect(formatPrice(0.15, "USD")).toBe("$0.150");
    expect(formatPrice(0.00375, "USD")).toBe("$0.00375");
    expect(formatPrice(0, "USD")).toBe("免费");
    expect(formatPrice(0, "USD", { locale: "en" })).toBe("Free");
    expect(formatPrice(null, "USD")).toBe("—");
    expect(formatPrice(1.07, "CNY", { approx: true })).toBe("≈ ¥1.07");
  });

  it("百分比带符号", () => {
    expect(formatPct(-0.5)).toBe("-50%");
    expect(formatPct(0.2)).toBe("+20%");
    expect(formatPct(0.004)).toBe("+0.4%");
    expect(formatPct(0)).toBe("0%");
    expect(formatPct(null)).toBe("—");
  });

  it("token 数量", () => {
    expect(formatTokens(128000)).toBe("128K");
    expect(formatTokens(131072)).toBe("128K");
    expect(formatTokens(1048576)).toBe("1M");
    expect(formatTokens(2000000)).toBe("2M");
    expect(formatTokens(1500000)).toBe("1.5M");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(null)).toBe("—");
  });
});

describe("schema", () => {
  const base = {
    id: "official:deepseek/deepseek-chat",
    vendor: "deepseek",
    model: "deepseek-chat",
    modelSlug: "deepseek/deepseek-chat",
    displayName: "DeepSeek-V3",
    platform: "official",
    source: "deepseek",
    currency: "CNY",
    input: 2,
    output: 8,
    cacheRead: 0.5,
    cacheWrite: null,
    tiers: null,
    contextWindow: 128000,
    maxOutput: null,
    modalities: ["text"],
    isFree: false,
    stale: false,
    status: "active",
    missingDays: 0,
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    notes: null,
    firstSeenAt: "2026-10-19",
    fetchedAt: "2026-10-19T00:01:33Z",
    publishedAt: "2026-10-19T00:04:12Z",
  };

  it("接受合法 Offering", () => {
    expect(OfferingSchema.safeParse(base).success).toBe(true);
  });

  it("拒绝负价格、http 链接和大写 ID", () => {
    expect(OfferingSchema.safeParse({ ...base, input: -1 }).success).toBe(false);
    expect(OfferingSchema.safeParse({ ...base, sourceUrl: "http://x.com" }).success).toBe(false);
    expect(OfferingSchema.safeParse({ ...base, vendor: "DeepSeek" }).success).toBe(false);
  });
});
