import type { Override } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  activeOverrides,
  checkModelCountDrop,
  checkPriceRange,
  checkStructure,
  exceedsRange,
} from "../../src/steps/validate";
import { makeCandidate } from "../helpers";

describe("validate", () => {
  it("V1：结构不符合 schema 的条目丢弃并记 E3001", () => {
    const good = {
      vendorHint: "openai",
      modelName: "gpt-4o",
      currency: "USD",
      unit: "per_token",
      input: 1e-6,
      output: 2e-6,
      sourceUrl: "https://openai.com/x",
    };
    const result = checkStructure(
      [
        good,
        { ...good, input: -1 },
        { ...good, currency: "EUR" },
        { ...good, sourceUrl: "http://openai.com" },
        "junk",
      ],
      "litellm",
    );
    expect(result.valid).toHaveLength(1);
    expect(result.warnings).toHaveLength(4);
    expect(result.warnings.every((w) => w.code === "E3001" && w.sourceId === "litellm")).toBe(true);
    expect(result.warnings[0]?.message).toContain("gpt-4o");
  });

  it("V2：换算成 USD 后超过 1000/1M 的丢弃并记 E3002", () => {
    const ok = makeCandidate({ model: "ok", id: "official:openai/ok", input: 999 });
    const tooHigh = makeCandidate({ model: "high", id: "official:openai/high", output: 1500 });
    const cnyOk = makeCandidate({
      model: "cny",
      id: "official:openai/cny",
      currency: "CNY",
      input: 7000,
    });
    const cnyHigh = makeCandidate({
      model: "cny2",
      id: "official:openai/cny2",
      currency: "CNY",
      input: 7200,
    });
    const tierHigh = makeCandidate({
      model: "tier",
      id: "official:openai/tier",
      tiers: [
        {
          minInputTokens: 0,
          maxInputTokens: null,
          input: 1,
          output: 2000,
          cacheRead: null,
          cacheWrite: null,
        },
      ],
    });
    const result = checkPriceRange([ok, tooHigh, cnyOk, cnyHigh, tierHigh], 7.1);
    expect(result.valid.map((c) => c.model)).toEqual(["ok", "cny"]);
    expect(result.invalidIds).toEqual([
      "official:openai/high",
      "official:openai/cny2",
      "official:openai/tier",
    ]);
    expect(result.warnings.map((w) => w.code)).toEqual(["E3002", "E3002", "E3002"]);
    expect(exceedsRange(makeCandidate({ input: null, output: null }), 7)).toBe(false);
  });

  it("V5：模型数 < 上次 50% 时整个源被拒绝（E3004）", () => {
    expect(checkModelCountDrop("deepseek", 4, 10)?.code).toBe("E3004");
    expect(checkModelCountDrop("deepseek", 0, 3)?.code).toBe("E3004");
    expect(checkModelCountDrop("deepseek", 5, 10)).toBeNull();
    expect(checkModelCountDrop("deepseek", 0, 0)).toBeNull();
  });

  it("V5：manual 源不适用", () => {
    expect(checkModelCountDrop("manual", 0, 10)).toBeNull();
  });

  it("V8：只保留 until ≥ 今天的覆盖", () => {
    const overrides: Override[] = [
      { offering: "a", action: "approve", until: "2026-10-18", reason: "今天最后一天" },
      { offering: "b", action: "block", until: "2026-10-17", reason: "已过期" },
      { offering: "c", action: "pin", until: "2026-12-01", reason: "钉住", price: { input: 1 } },
    ];
    const active = activeOverrides(overrides, "2026-10-18");
    expect([...active.keys()]).toEqual(["a", "c"]);
  });
});
