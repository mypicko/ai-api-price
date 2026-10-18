import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawMediaOfferingSchema, type RawMediaOffering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import { OPENROUTER_URL, openrouterSource } from "../../src/sources/openrouter";
import {
  OPENROUTER_VIDEOS_URL,
  parseOpenRouterVideos,
  parseSku,
  videoTokensPerSecond,
} from "../../src/sources/openrouter-videos";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const FIXTURE = path.join(FIXTURES_DIR, "openrouter/2026-10-18-2.json");
const UNKNOWN = new Set(["heygen", "kwaivgi"]);
const loadFixture = async (): Promise<unknown> => JSON.parse(await readFile(FIXTURE, "utf8"));
const parse = async (logger = silentLogger) =>
  parseOpenRouterVideos(await loadFixture(), {
    isKnownVendor: (v) => !UNKNOWN.has(v),
    logger,
  });
const find = (list: readonly RawMediaOffering[], modelName: string) =>
  list.find((o) => o.modelName === modelName);

describe("source/openrouter 视频", () => {
  it("MiniMax H3 Max：duration_seconds 是美元/秒，分辨率写进 tiers", async () => {
    const max = find(await parse(), "hailuo-3-max");
    expect(max).toEqual({
      vendorHint: "minimax",
      modelName: "hailuo-3-max",
      displayName: "H3 Max",
      currency: "USD",
      media: { kind: "video", unit: "per_second" },
      input: null,
      output: 0.08,
      tiers: [
        { label: "480p", output: 0.05 },
        { label: "768p", output: 0.08 },
      ],
      modalities: ["text", "image"],
      sourceUrl: "https://openrouter.ai/minimax/hailuo-3-max",
    });
  });

  it("cents_* 换算成美元；没有默认价时取最便宜的一档", async () => {
    const grok = find(await parse(), "grok-imagine-video-1.5");
    expect(grok).toMatchObject({
      vendorHint: "x-ai",
      input: 0.01,
      output: 0.08,
      tiers: [
        { label: "480p", output: 0.08 },
        { label: "720p", output: 0.14 },
        { label: "1080p", output: 0.25 },
      ],
    });
    const flux = find(await parse(), "flux-3-video");
    expect(flux?.output).toBe(0.17);
    expect(flux?.tiers).toEqual(
      expect.arrayContaining([
        { label: "4k", output: 0.41 },
        { label: "续写 1080p", output: 0.53 },
      ]),
    );
  });

  it("有声/无声、文生/图生、参考图作为带前缀的档位；参考图价写入 input", async () => {
    const veo = find(await parse(), "veo-3.1");
    expect(veo?.output).toBe(0.2);
    expect(veo?.tiers).toEqual([
      { label: "无声", output: 0.2 },
      { label: "无声 4k", output: 0.4 },
      { label: "有声", output: 0.4 },
      { label: "有声 4k", output: 0.6 },
    ]);
    const wan = find(await parse(), "wan-2.6");
    expect(wan?.tiers?.map((t) => t.label)).toContain("图生 1080p");
    const h3 = find(await parse(), "hailuo-3");
    expect(h3).toMatchObject({ output: 0.13, input: 0.04 });
    expect(h3?.tiers).toBeUndefined();
  });

  it("每次最低收费写入 notes", async () => {
    const aleph = find(await parse(), "aleph-2");
    expect(aleph).toMatchObject({ output: 0.28, notes: "每次生成最低 0.56 USD" });
  });

  it("Seedance：video_tokens 按 16:9、24fps 换算成美元/秒，各分辨率写进 tiers", async () => {
    const seedance = find(await parse(), "seedance-2.0");
    // 480p = 854×480×24/1024 = 9607.5 token/秒；1080p、4k 有各自的单价
    expect(seedance).toMatchObject({
      vendorHint: "bytedance",
      displayName: "Seedance 2.0",
      input: null,
      output: 0.0672525,
      tiers: [
        { label: "480p", output: 0.0672525 },
        { label: "720p", output: 0.1512 },
        { label: "1080p", output: 0.37422 },
        { label: "4k", output: 0.7776 },
      ],
    });
    expect(seedance?.notes).toContain("16:9");
    expect(seedance?.notes).toContain("24fps");
    expect(find(await parse(), "seedance-2.5")?.tiers).toEqual([
      { label: "480p", output: 0.1028 },
      { label: "720p", output: 0.23112 },
    ]);
  });

  it("Seedance：无声价不同时加「无声」档位", async () => {
    const pro = find(await parse(), "seedance-1-5-pro");
    expect(pro?.output).toBe(0.011529);
    expect(pro?.tiers).toEqual(
      expect.arrayContaining([
        { label: "720p", output: 0.05184 },
        { label: "无声 720p", output: 0.02592 },
      ]),
    );
    expect(find(await parse(), "seedance-2.0-fast")?.tiers?.map((t) => t.label)).toEqual([
      "480p",
      "720p",
    ]);
  });

  it("videoTokensPerSecond：已知分辨率按标准 16:9 尺寸，未知为 null", () => {
    expect(videoTokensPerSecond("480p")).toBe(9607.5);
    expect(videoTokensPerSecond("720P")).toBe(21600);
    expect(videoTokensPerSecond("4k")).toBe(194400);
    expect(videoTokensPerSecond("768p")).toBeNull();
  });

  it("按 token 计价但分辨率无法换算、按百万像素·秒计价的 SKU：跳过并记 W2003", async () => {
    const lines: string[] = [];
    const list = await parse(createLogger({ level: "warn", write: (l) => lines.push(l) }));
    expect(find(list, "flux-video-upscale")).toBeUndefined();
    const warnings = lines.map((l) => JSON.parse(l) as { code?: string; skus?: string[] });
    expect(warnings.every((w) => w.code === "W2003")).toBe(true);
    const skus = warnings.flatMap((w) => w.skus ?? []);
    expect(skus).toContain("cents_per_megapixel_second_precise");
    expect(skus.some((s) => s.startsWith("video_tokens"))).toBe(false);

    const odd = {
      data: [
        {
          id: "bytedance/seedance-x",
          supported_resolutions: ["768p"],
          pricing_skus: { video_tokens: "0.000007" },
        },
        { id: "bytedance/seedance-y", pricing_skus: { video_tokens: "0.000007" } },
      ],
    };
    const oddLines: string[] = [];
    const none = parseOpenRouterVideos(odd, {
      isKnownVendor: () => true,
      logger: createLogger({ level: "warn", write: (l) => oddLines.push(l) }),
    });
    expect(none).toEqual([]);
    expect(oddLines).toHaveLength(2);
    expect(oddLines.every((l) => l.includes('"W2003"') && l.includes("video_tokens"))).toBe(true);
  });

  it("只保留已知厂商；全部输出符合 RawMediaOffering", async () => {
    const list = await parse();
    expect(list.some((o) => UNKNOWN.has(o.vendorHint))).toBe(false);
    expect(list.length).toBeGreaterThanOrEqual(15);
    for (const o of list) expect(RawMediaOfferingSchema.safeParse(o).success).toBe(true);
  });

  it("parseSku：识别单位、前缀和分辨率", () => {
    expect(parseSku("cents_per_video_output_second_720p", "3")).toEqual({
      role: "output",
      label: "720p",
      usd: 0.03,
    });
    expect(parseSku("duration_seconds", "0.08")).toEqual({ role: "output", label: "", usd: 0.08 });
    expect(parseSku("duration_seconds_with_audio_4k", "0.6")).toEqual({
      role: "output",
      label: "有声 4k",
      usd: 0.6,
    });
    expect(parseSku("text_to_video_duration_seconds_2K", "0.1")?.label).toBe("文生 2k");
    expect(parseSku("cents_per_image_input", "0.2")).toEqual({
      role: "input",
      label: "",
      usd: 0.002,
    });
    expect(parseSku("reference_input_images", "0.04")?.role).toBe("input");
    expect(parseSku("minimum_cents_per_generation", "56")).toEqual({
      role: "minimum",
      label: "",
      usd: 0.56,
    });
    expect(parseSku("duration_seconds", "-1")).toBeNull();
    expect(parseSku("duration_seconds", "abc")).toBeNull();
  });

  it("缺 data 数组时抛 E2001", () => {
    expect(() =>
      parseOpenRouterVideos({}, { isKnownVendor: () => true, logger: silentLogger }),
    ).toThrow(expect.objectContaining({ code: "E2001" }));
  });

  it("fetch：文本和视频报价一起返回；视频接口失败时只返回文本", async () => {
    const ctx = { browser: noopBrowser, logger: silentLogger, now: NOW, rootDir: ROOT_DIR };
    const text = await readFile(path.join(FIXTURES_DIR, "openrouter/2026-10-18-1.json"), "utf8");
    const videos = await readFile(FIXTURE, "utf8");
    const both = await openrouterSource.fetch({
      ...ctx,
      http: createFakeHttp({ [OPENROUTER_URL]: text, [OPENROUTER_VIDEOS_URL]: videos }),
    });
    const media = both.filter((o) => "media" in o);
    expect(media.length).toBeGreaterThan(0);
    expect(media.some((o) => o.modelName === "hailuo-3-max")).toBe(true);
    const textOnly = await openrouterSource.fetch({
      ...ctx,
      http: createFakeHttp({ [OPENROUTER_URL]: text }),
    });
    expect(textOnly.some((o) => "media" in o)).toBe(false);
    expect(textOnly.length).toBe(both.length - media.length);
  });
});
