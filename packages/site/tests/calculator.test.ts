import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS,
  computeUsage,
  monthlyCost,
  parsePercent,
  parseTokenInput,
  rankOfferings,
  selectTier,
  type CalcOffering,
} from "../src/lib/calculator";

const base: CalcOffering = {
  id: "official:deepseek/deepseek-chat",
  modelSlug: "deepseek/deepseek-chat",
  displayName: "DeepSeek-V3",
  vendor: "deepseek",
  vendorName: "DeepSeek",
  platform: "official",
  platformName: "官方",
  currency: "CNY",
  input: 2,
  output: 8,
  cacheRead: 0.5,
  cacheWrite: null,
  tiers: null,
};

const tiered: CalcOffering = {
  ...base,
  id: "official:alibaba/qwen3-max",
  vendor: "alibaba",
  input: 6,
  output: 24,
  cacheRead: null,
  tiers: [
    {
      minInputTokens: 0,
      maxInputTokens: 32000,
      input: 6,
      output: 24,
      cacheRead: null,
      cacheWrite: null,
    },
    {
      minInputTokens: 32000,
      maxInputTokens: 128000,
      input: 10,
      output: 40,
      cacheRead: null,
      cacheWrite: null,
    },
    {
      minInputTokens: 128000,
      maxInputTokens: null,
      input: 15,
      output: 60,
      cacheRead: null,
      cacheWrite: null,
    },
  ],
};

describe("calculator 输入解析", () => {
  it("支持 k / m / 万 后缀和千分位", () => {
    expect(parseTokenInput("2k")).toBe(2000);
    expect(parseTokenInput("1m")).toBe(1_000_000);
    expect(parseTokenInput("1.5M")).toBe(1_500_000);
    expect(parseTokenInput("2,000")).toBe(2000);
    expect(parseTokenInput(" 500 ")).toBe(500);
    expect(parseTokenInput("10万")).toBe(100_000);
    expect(parseTokenInput("1b")).toBe(1e9);
    expect(parseTokenInput(".5k")).toBe(500);
  });

  it("非法输入返回 null", () => {
    expect(parseTokenInput("")).toBeNull();
    expect(parseTokenInput("-5")).toBeNull();
    expect(parseTokenInput("abc")).toBeNull();
    expect(parseTokenInput("2kk")).toBeNull();
  });

  it("百分比 0~100", () => {
    expect(parsePercent("30")).toBe(0.3);
    expect(parsePercent("50%")).toBe(0.5);
    expect(parsePercent("101")).toBeNull();
    expect(parsePercent("x")).toBeNull();
  });
});

describe("calculator 公式", () => {
  it("按每次请求计算月用量", () => {
    expect(computeUsage(DEFAULT_INPUTS)).toEqual({
      monthlyInput: 60_000_000,
      monthlyOutput: 15_000_000,
      cachedInput: 0,
      perRequestInput: 2000,
    });
  });

  it("按每月总量计算，缓存命中率限制在 0~1", () => {
    const usage = computeUsage({
      ...DEFAULT_INPUTS,
      mode: "monthly",
      monthlyInput: 1e6,
      monthlyOutput: 2e5,
      cacheHitRate: 1.5,
    });
    expect(usage).toEqual({
      monthlyInput: 1e6,
      monthlyOutput: 2e5,
      cachedInput: 1e6,
      perRequestInput: null,
    });
  });

  it("月成本 = ((M_in − M_c) × input + M_c × cacheRead + M_out × output) / 1e6", () => {
    const usage = computeUsage({ ...DEFAULT_INPUTS, cacheHitRate: 0.5 });
    // (30M × 2 + 30M × 0.5 + 15M × 8) / 1e6 = 60 + 15 + 120
    expect(monthlyCost(base, usage)).toBe(195);
  });

  it("没有缓存价时缓存部分按输入价计算", () => {
    const usage = computeUsage({ ...DEFAULT_INPUTS, cacheHitRate: 0.5 });
    expect(monthlyCost({ ...base, cacheRead: null }, usage)).toBe(240);
  });

  it("输入或输出价缺失时无法计算", () => {
    expect(monthlyCost({ ...base, output: null }, computeUsage(DEFAULT_INPUTS))).toBeNull();
  });

  it("按单次输入 token 选择阶梯价", () => {
    expect(selectTier(tiered, 2000).tierIndex).toBe(0);
    expect(selectTier(tiered, 32000).tierIndex).toBe(1);
    expect(selectTier(tiered, 500_000).prices.input).toBe(15);
    expect(selectTier(tiered, null).tierIndex).toBe(0);
    expect(selectTier(base, 2000)).toEqual({ prices: base, tierIndex: null });
    const gap = {
      ...tiered,
      tiers: [
        {
          minInputTokens: 1000,
          maxInputTokens: 2000,
          input: 1,
          output: 1,
          cacheRead: null,
          cacheWrite: null,
        },
      ],
    };
    expect(selectTier(gap, 10).tierIndex).toBe(0);
  });
});

describe("calculator 排行", () => {
  const usd: CalcOffering = {
    ...base,
    id: "openrouter:openai/gpt-5",
    vendor: "openai",
    currency: "USD",
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
  };
  const broken: CalcOffering = { ...base, id: "x:y/z", vendor: "y", output: null };

  it("按所选币种的月成本升序，跳过无法计算的模型", () => {
    const usage = computeUsage(DEFAULT_INPUTS);
    const results = rankOfferings([usd, base, tiered, broken], usage, {
      currency: "CNY",
      usdCny: 7,
      vendors: [],
    });
    expect(results.map((r) => r.offering.id)).toEqual([
      "official:deepseek/deepseek-chat",
      "official:alibaba/qwen3-max",
      "openrouter:openai/gpt-5",
    ]);
    const gpt = results[2];
    expect(gpt?.isConverted).toBe(true);
    expect(gpt?.cost).toBeCloseTo(gpt ? gpt.costOriginal * 7 : 0, 6);
    expect(results[1]?.tierIndex).toBe(0);
  });

  it("按厂商过滤并限制条数", () => {
    const usage = computeUsage(DEFAULT_INPUTS);
    expect(
      rankOfferings([usd, base, tiered], usage, {
        currency: "USD",
        usdCny: 7,
        vendors: ["openai"],
      }),
    ).toHaveLength(1);
    expect(
      rankOfferings([usd, base, tiered], usage, {
        currency: "USD",
        usdCny: 7,
        vendors: [],
        limit: 2,
      }),
    ).toHaveLength(2);
  });
});
