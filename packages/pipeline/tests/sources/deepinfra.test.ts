import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import {
  DEEPINFRA_URL,
  activeDiscount,
  deepinfraSource,
  parseDeepinfra,
} from "../../src/sources/deepinfra";
import { createFakeHttp, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const model = (name: string, extra: Record<string, unknown> = {}, pricing = {}) => ({
  model_name: name,
  type: "text-generation",
  pricing: {
    type: "tokens",
    cents_per_input_token: 2e-5,
    cents_per_output_token: 6e-5,
    rate_per_input_token_cached: 0.1,
    discount: null,
    discount_ends_at: null,
    ...pricing,
  },
  max_tokens: 131072,
  deprecated: null,
  private: 0,
  quantization: "fp8",
  ...extra,
});

describe("deepinfra", () => {
  it("美分 / token 换成美元 / token，缓存价按倍率换算，识别厂商", () => {
    const [raw] = parseDeepinfra([model("deepseek-ai/DeepSeek-V4.1-Flash")], NOW);
    expect(raw).toMatchObject({
      vendorHint: "deepseek",
      modelName: "DeepSeek-V4.1-Flash",
      platform: "deepinfra",
      currency: "USD",
      unit: "per_token",
      input: 2e-7,
      output: 6e-7,
      cacheRead: 2e-8,
      contextWindow: 131072,
      sourceUrl: "https://deepinfra.com/deepseek-ai/DeepSeek-V4.1-Flash",
    });
    expect(raw?.notes).toContain("fp8");
  });

  it("折扣：实际价 = 标价 × (1 − discount)，过期折扣不算", () => {
    const [raw] = parseDeepinfra([model("Qwen/Qwen3.8-27B", {}, { discount: 0.25 })], NOW);
    expect(raw?.input).toBeCloseTo(1.5e-7, 15);
    expect(raw?.notes).toContain("官方折扣 25%");
    const [flex] = parseDeepinfra(
      [model("Qwen/Qwen3-Next-80B-A3B-Instruct", {}, { rate_per_service_tier_flex: 0.8 })],
      NOW,
    );
    expect(flex?.input).toBe(2e-7);
    expect(flex?.notes).toContain("Flex 档 0.8×");
    expect(activeDiscount({ discount: 0.25, discount_ends_at: NOW_SEC - 1 }, NOW)).toBe(0);
    expect(activeDiscount({ discount: 0.25, discount_ends_at: NOW_SEC + 60 }, NOW)).toBe(0.25);
    expect(activeDiscount({ discount: 1.5 }, NOW)).toBe(0);
  });

  it("跳过非文本、非按 token、私有、已下线、认不出厂商的模型", () => {
    const raws = parseDeepinfra(
      [
        model("deepseek-ai/DeepSeek-V4.1-Flash"),
        model("black-forest-labs/FLUX", { type: "text-to-image" }),
        model("meta-llama/Llama-4", {}, { type: "time" }),
        model("deepseek-ai/private", { private: 1 }),
        model("deepseek-ai/old", { deprecated: NOW_SEC - 10 }),
        model("deepseek-ai/soon", { deprecated: NOW_SEC + 3600 }),
        model("someone/finetune-x"),
        { model_name: 42 },
      ],
      NOW,
    );
    expect(raws.map((r) => r.modelName)).toEqual(["DeepSeek-V4.1-Flash", "soon"]);
  });

  it("接口返回空或格式不对时报 E2001", async () => {
    expect(() => parseDeepinfra({ error: "x" }, NOW)).toThrow();
    const http = createFakeHttp({ [DEEPINFRA_URL]: "[]" });
    await expect(
      deepinfraSource.fetch({
        http,
        browser: noopBrowser,
        logger: silentLogger,
        now: NOW,
        rootDir: ROOT_DIR,
      }),
    ).rejects.toMatchObject({ code: "E2001" });
  });
});
