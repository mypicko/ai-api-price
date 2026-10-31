import type { PlatformConfig } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { createPlatformMatcher, parseLitellmResellers } from "../../src/sources/litellm-resellers";

const platform = (
  id: string,
  matchers: string[],
  pricingUrl: string | null = null,
): PlatformConfig => ({
  id,
  nameZh: id,
  nameEn: id,
  website: `https://${id}.example.com`,
  pricingUrl,
  category: "cloud",
  matchers,
  allowedSourceDomains: [`${id}.example.com`],
});

const PLATFORMS = [
  platform(
    "bedrock",
    ["bedrock", "bedrock_converse", "Amazon Bedrock"],
    "https://bedrock.example.com/pricing",
  ),
  platform("vertex", ["vertex_ai*", "Google Vertex"]),
  platform("deepinfra", ["deepinfra", "DeepInfra"]),
];

const entry = (provider: string, input: number, extra: Record<string, unknown> = {}) => ({
  litellm_provider: provider,
  mode: "chat",
  input_cost_per_token: input,
  output_cost_per_token: input * 4,
  max_input_tokens: 200000,
  ...extra,
});

describe("litellm-resellers", () => {
  it("平台识别：精确匹配、末尾 * 前缀匹配、不区分大小写", () => {
    const match = createPlatformMatcher(PLATFORMS);
    expect(match("bedrock_converse")?.id).toBe("bedrock");
    expect(match("vertex_ai-anthropic_models")?.id).toBe("vertex");
    expect(match("DEEPINFRA")?.id).toBe("deepinfra");
    expect(match("amazon bedrock")?.id).toBe("bedrock");
    expect(match("aihubmix")).toBeNull();
  });

  it("按 AWS 区域单列的 Bedrock 价格让位给标准价格，模型名去掉区域和厂商前缀", () => {
    const data = {
      "bedrock/ap-northeast-1/minimax.minimax-m2.1": entry("bedrock", 0.00000036),
      "bedrock/eu-west-2/minimax.minimax-m2.1": entry("bedrock", 0.00000047),
      "bedrock/us-east-1/minimax.minimax-m2.1": entry("bedrock", 0.0000003),
      "minimax.minimax-m2.1": entry("bedrock_converse", 0.0000003),
    };
    const raws = parseLitellmResellers(data, {
      matchPlatform: createPlatformMatcher(PLATFORMS),
      today: "2026-10-23",
    });
    expect(raws.map((r) => [r.modelName, r.input])).toEqual([["minimax-m2.1", 0.0000003]]);
  });

  it("只收已配置平台、能推断厂商的文本条目，并清洗模型名", () => {
    const data = {
      "us.anthropic.claude-3-5-sonnet-20240620-v1:0": entry("bedrock", 0.0000033),
      "anthropic.claude-3-5-sonnet-20240620-v1:0": entry("bedrock", 0.000003),
      "vertex_ai/claude-3-5-haiku@20241022": entry("vertex_ai-anthropic_models", 0.0000008),
      "deepinfra/deepseek-ai/DeepSeek-V3": entry("deepinfra", 0.00000049),
      "deepinfra/Gryphe/MythoMax-L2-13b": entry("deepinfra", 0.00000007),
      "aihubmix/gpt-4o": entry("aihubmix", 0.0000025),
      "openai/gpt-4o": entry("openai", 0.0000025),
      "bedrock/embed": entry("bedrock", 0.0000001, { mode: "embedding" }),
      "bedrock/old-claude": entry("bedrock", 0.000008, { deprecation_date: "2026-01-01" }),
    };
    const result = parseLitellmResellers(data, {
      today: "2026-10-19",
      matchPlatform: createPlatformMatcher(PLATFORMS),
    });
    expect(result.map((r) => [r.platform, r.vendorHint, r.modelName])).toEqual([
      ["bedrock", "anthropic", "claude-3-5-sonnet-20240620"],
      ["vertex", "anthropic", "claude-3-5-haiku-20241022"],
      ["deepinfra", "deepseek", "DeepSeek-V3"],
    ]);
    // 区域前缀版本（us.）只作为备选：同一平台同一模型保留不带区域前缀的那条
    expect(result[0]).toMatchObject({
      input: 0.000003,
      unit: "per_token",
      currency: "USD",
      contextWindow: 200000,
      sourceUrl: "https://bedrock.example.com/pricing",
    });
    // 没有 pricingUrl 时用平台官网
    expect(result[1]?.sourceUrl).toBe("https://vertex.example.com");
  });

  it("不是对象时报 E2001", () => {
    expect(() =>
      parseLitellmResellers([], { today: "2026-10-19", matchPlatform: () => null }),
    ).toThrow(/E2001/);
  });
});
