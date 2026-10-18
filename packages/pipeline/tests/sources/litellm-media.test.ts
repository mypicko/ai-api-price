import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawMediaOfferingSchema, type RawMediaOffering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { entryTiers, parseLitellmMedia, parseVariantKey } from "../../src/sources/litellm-media";
import { LITELLM_URL } from "../../src/sources/litellm";
import { FIXTURES_DIR } from "../helpers";

const FIXTURE = path.join(FIXTURES_DIR, "litellm/2026-10-18-media.json");
const load = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(FIXTURE, "utf8")) as Record<string, unknown>;
const options = {
  today: "2026-10-18",
  pricingUrlFor: (hint: string) => (hint === "minimax" ? null : `https://${hint}.example/pricing`),
  isAllowedUrl: (hint: string, url: string) =>
    hint === "minimax" && url.startsWith("https://platform.minimax.io/"),
};
const find = (list: readonly RawMediaOffering[], vendorHint: string, modelName: string) =>
  list.find((o) => o.vendorHint === vendorHint && o.modelName === modelName);

describe("source/litellm 视频/图像", () => {
  it("MiniMax H3 / H3-Max：按秒计价，带分辨率档位和输入图价", async () => {
    const list = parseLitellmMedia(await load(), options);
    const h3 = find(list, "minimax", "MiniMax-H3");
    expect(h3).toMatchObject({
      currency: "USD",
      media: { kind: "video", unit: "per_second" },
      output: 0.08,
      input: 0.04,
      tiers: [
        { label: "768p", output: 0.08 },
        { label: "2k", output: 0.13 },
      ],
    });
    // 条目自带的 source 在白名单内时作为证据链接
    expect(h3?.sourceUrl).toBe("https://platform.minimax.io/docs/guides/pricing-paygo");
    const max = find(list, "minimax", "MiniMax-H3-Max");
    expect(max?.output).toBe(0.08);
    expect(max?.tiers?.map((t) => t.label)).toEqual(["480p", "768p"]);
  });

  it("只收厂商直连，排除转售、已弃用和没有按秒/按张价格的条目", async () => {
    const list = parseLitellmMedia(await load(), options);
    const names = list.map((o) => `${o.vendorHint}:${o.modelName}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "gemini:veo-3.1-generate-001",
        "gemini:veo-3.1-generate-preview",
        "runway:gen4.5",
        "runway:gen4_turbo",
        "alibaba:wan3.0-video",
        "bytedance:doubao-seedance-2-0-260128",
        "xai:grok-imagine-video",
        "stability:sd3",
        "black-forest-labs:flux-pro-1.1",
        "recraft:recraftv3",
        "gemini:gemini-3-pro-image",
        "openai:gpt-image-1",
        "xai:grok-imagine-image-2.0",
      ]),
    );
    expect(names).not.toContain("openai:sora-2"); // 已弃用
    expect(names).not.toContain("runway:veo3.1"); // Runway 转售
    expect(names).not.toContain("gemini:gemini-2.0-flash-exp-image-generation"); // 已弃用
    expect(names).not.toContain("alibaba:qwen-image-3.0"); // 没有按张价格
    expect(names.some((n) => n.includes("veo-2.0"))).toBe(false); // vertex 转售
    expect(names.some((n) => n.includes("seedance-2.5"))).toBe(false); // fal 转售
    expect(names.filter((n) => n === "alibaba:wan3.0-video")).toHaveLength(1); // 不收 qwencloud
    expect(list).toHaveLength(15); // 上面 13 个 + MiniMax H3 / H3-Max
    expect(list.every((o) => RawMediaOfferingSchema.safeParse(o).success)).toBe(true);
  });

  it("output_cost_per_video_per_second 也算按秒价格", async () => {
    const list = parseLitellmMedia(await load(), options);
    expect(find(list, "runway", "gen4_turbo")).toMatchObject({ output: 0.05, input: null });
    expect(find(list, "runway", "gen4_turbo")?.tiers).toBeUndefined();
  });

  it("图像：output_cost_per_image 优先，input_cost_per_image 作为输入图价", async () => {
    const list = parseLitellmMedia(await load(), options);
    expect(find(list, "gemini", "gemini-3-pro-image")).toMatchObject({
      media: { kind: "image", unit: "per_image" },
      output: 0.134,
      input: 0.0011,
    });
    expect(find(list, "stability", "sd3")).toMatchObject({ output: 0.065, input: null });
    expect(find(list, "stability", "sd3")?.sourceUrl).toBe("https://stability.example/pricing");
  });

  it("OpenAI 的质量/尺寸变体合并成档位；没有默认档时取最低档", async () => {
    const list = parseLitellmMedia(await load(), options);
    const gpt = find(list, "openai", "gpt-image-1");
    expect(gpt?.output).toBe(0.011);
    expect(gpt?.input).toBeNull();
    expect(gpt?.tiers).toEqual([
      { label: "low 1024x1024", output: 0.011 },
      { label: "medium 1024x1024", output: 0.042 },
      { label: "high 1024x1536", output: 0.25 },
    ]);
  });

  it("有默认档时保留默认价，变体作为附加档位", async () => {
    const list = parseLitellmMedia(await load(), options);
    const grok = find(list, "xai", "grok-imagine-image-2.0");
    expect(grok?.output).toBe(0.06);
    expect(grok?.tiers).toEqual([{ label: "low 1024x1024", output: 0.04 }]);
  });

  it("证据链接：不在白名单时回落到厂商定价页，再回落到 LiteLLM", async () => {
    const data = await load();
    const list = parseLitellmMedia(data, { ...options, isAllowedUrl: () => false });
    expect(find(list, "minimax", "MiniMax-H3")?.sourceUrl).toBe(LITELLM_URL);
    expect(find(list, "bytedance", "doubao-seedance-2-0-260128")?.sourceUrl).toBe(
      "https://bytedance.example/pricing",
    );
  });

  it("跳过不合法的条目", () => {
    const list = parseLitellmMedia(
      {
        bad: { litellm_provider: "minimax", mode: "video_generation", output_cost_per_second: -1 },
        str: "x",
      },
      options,
    );
    expect(list).toEqual([]);
  });
});

describe("parseVariantKey / entryTiers", () => {
  it("解析质量和尺寸前缀，忽略 provider 前缀", () => {
    expect(parseVariantKey("high/1024-x-1536/gpt-image-1")).toEqual({
      modelName: "gpt-image-1",
      variant: "high 1024x1536",
    });
    expect(parseVariantKey("1024-x-1024/gpt-image-1.5")).toEqual({
      modelName: "gpt-image-1.5",
      variant: "1024x1024",
    });
    expect(parseVariantKey("gemini/imagen-3.0-generate-001")).toEqual({
      modelName: "imagen-3.0-generate-001",
      variant: null,
    });
  });

  it("图像按尺寸分档，跳过按 token 的字段", () => {
    const entry = {
      litellm_provider: "gemini",
      mode: "image_generation",
      output_cost_per_image: 0.08,
      output_cost_per_image_1K: 0.08,
      output_cost_per_image_4K: 0.16,
      output_cost_per_image_token: 0.00003,
    };
    expect(entryTiers(entry, "image")).toEqual([
      { label: "1k", output: 0.08 },
      { label: "4k", output: 0.16 },
    ]);
  });
});
