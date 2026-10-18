import type { Offering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { harmonizeDisplayNames, isRawName, unifyDisplayNames } from "../../src/steps/display-names";

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

  it("视频/图像：同一 modelSlug 统一成一个名称，带空格的名称优先于 ID 写法", () => {
    const media = (platform: string, model: string, displayName: string): Offering =>
      ({ platform, model, modelSlug: `minimax/${model}`, displayName }) as Offering;
    const result = unifyDisplayNames([
      media("official", "minimax-h3-max", "MiniMax-H3-Max"),
      media("openrouter", "minimax-h3-max", "H3 Max"),
      media("official", "veo-3.1-generate-001", "veo-3.1-generate-001"),
      media("openrouter", "veo-3.1-generate-001", "Veo 3.1"),
      media("official", "minimax-h3", "MiniMax H3"),
      media("openrouter", "minimax-h3", "H3"),
      media("official", "sora-2", "sora-2"),
    ]);
    expect(result.map((o) => o.displayName)).toEqual([
      "H3 Max",
      "H3 Max",
      "Veo 3.1",
      "Veo 3.1",
      "MiniMax H3",
      "MiniMax H3",
      "sora-2",
    ]);
  });

  it("视频/图像：都是 ID 写法时按平台优先级取名称", () => {
    const media = (platform: string, displayName: string): Offering =>
      ({
        platform,
        model: "wan3.0-video",
        modelSlug: "alibaba/wan3.0-video",
        displayName,
      }) as Offering;
    const result = unifyDisplayNames([
      media("openrouter", "wan3.0-video"),
      media("official", "Wan3.0-Video"),
    ]);
    expect(result.map((o) => o.displayName)).toEqual(["Wan3.0-Video", "Wan3.0-Video"]);
  });
});
