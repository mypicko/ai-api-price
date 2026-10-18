import type { Offering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { harmonizeDisplayNames, isRawName } from "../../src/steps/display-names";

function offering(platform: string, model: string, displayName: string): Offering {
  return { platform, model, modelSlug: `anthropic/${model}`, displayName } as Offering;
}

describe("display-names", () => {
  it("识别原始 ID 形式的名称", () => {
    expect(isRawName("claude-sonnet-4-5", "claude-sonnet-4.5")).toBe(true);
    expect(isRawName("Claude Sonnet 4.5", "claude-sonnet-4.5")).toBe(false);
  });

  it("原始 ID 借用其他平台的友好名称，已有好名称的不变", () => {
    const result = harmonizeDisplayNames([
      offering("official", "claude-sonnet-4.5", "claude-sonnet-4-5"),
      offering("openrouter", "claude-sonnet-4.5", "Claude Sonnet 4.5"),
      offering("official", "claude-opus-4.1", "claude-opus-4-1"),
    ]);
    expect(result.map((o) => o.displayName)).toEqual([
      "Claude Sonnet 4.5",
      "Claude Sonnet 4.5",
      "claude-opus-4-1",
    ]);
  });

  it("没有官方友好名称时，OpenRouter 优先于其他平台", () => {
    const result = harmonizeDisplayNames([
      offering("siliconflow", "deepseek-v4-pro", "DeepSeek-V4-Pro-0813"),
      offering("openrouter", "deepseek-v4-pro", "DeepSeek V4 Pro"),
      offering("official", "deepseek-v4-pro", "deepseek-v4-pro"),
    ]);
    expect(result.map((o) => o.displayName)).toEqual([
      "DeepSeek-V4-Pro-0813",
      "DeepSeek V4 Pro",
      "DeepSeek V4 Pro",
    ]);
  });

  it("官方平台的友好名称优先", () => {
    const result = harmonizeDisplayNames([
      offering("openrouter", "deepseek-chat", "DeepSeek V3"),
      offering("official", "deepseek-chat", "DeepSeek-V3.2"),
      offering("siliconflow", "deepseek-chat", "deepseek-chat"),
    ]);
    expect(result.map((o) => o.displayName)).toEqual([
      "DeepSeek V3",
      "DeepSeek-V3.2",
      "DeepSeek-V3.2",
    ]);
  });
});
