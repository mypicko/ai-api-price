import { describe, expect, it } from "vitest";
import { canonicalModelId, normalizeModelId } from "../src/slug";

describe("canonicalModelId：统一各平台写法", () => {
  it.each([
    ["qwen2p5-72b-instruct", "qwen2.5-72b-instruct"],
    ["qwen2p5-coder-0p5b", "qwen2.5-coder-0.5b"],
    ["glm-4p5v", "glm-4.5v"],
    ["deepseek-coder-7b-base-v1p5", "deepseek-coder-7b-base-v1.5"],
    ["llama-v3p3-70b-instruct", "llama-3.3-70b-instruct"],
    ["llama-v2-13b-chat", "llama-2-13b-chat"],
    ["qwen-2.5-72b-instruct", "qwen2.5-72b-instruct"],
    ["qwen-v2p5-7b", "qwen2.5-7b"],
    ["qwen25-coder-32b-instruct", "qwen2.5-coder-32b-instruct"],
    ["qwen35-122b-a10b", "qwen3.5-122b-a10b"],
    ["deepseek.v3.2", "deepseek-v3.2"],
    ["nvidia.nemotron-nano-9b-v2", "nemotron-nano-9b-v2"],
    ["nvidia-nemotron-3-super-120b-a12b", "nemotron-3-super-120b-a12b"],
    ["qwen.qwen3-coder-next", "qwen3-coder-next"],
    ["minimax.minimax-m2.1", "minimax-m2.1"],
    ["mistral.mixtral-8x7b-instruct", "mixtral-8x7b-instruct"],
    ["gpt-35-turbo", "gpt-3.5-turbo"],
    ["deepseek-v4-1-flash-1017", "deepseek-v4.1-flash-1017"],
    ["mistral-7b-instruct-v0-2", "mistral-7b-instruct-v0.2"],
    ["grok-4-20-reasoning", "grok-4.20-reasoning"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalModelId(input)).toBe(expected);
  });

  it.each([
    "gpt-4o-2024-08-06",
    "claude-3.5-sonnet-20241022",
    "deepseek-v3.2",
    "qwen-max",
    "qwen3-32b",
    "grok-2-1212",
    "gpt-4.1",
    "llama-3.3-70b-instruct",
    "mixtral-8x7b-instruct",
    "o4-mini",
    "deepseek-v3-0324",
  ])("不该改动：%s", (id) => {
    expect(canonicalModelId(id)).toBe(id);
  });

  it("幂等：规范结果再处理一次不变", () => {
    for (const raw of ["Qwen2p5-72B-Instruct", "llama-v3p1-8b", "deepseek.v3.2", "qwen-3-14b"]) {
      const once = canonicalModelId(normalizeModelId(raw));
      expect(canonicalModelId(normalizeModelId(once))).toBe(once);
    }
  });
});
