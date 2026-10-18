import { describe, expect, it } from "vitest";
import {
  formatMediaPrice,
  MediaLatestFileSchema,
  MediaOfferingSchema,
  mediaUnitSuffix,
  RawMediaOfferingSchema,
  SCHEMA_VERSION,
  StatusFileSchema,
  type MediaOffering,
} from "../src";

const OFFERING: MediaOffering = {
  id: "official:minimax/minimax-h3",
  vendor: "minimax",
  model: "minimax-h3",
  modelSlug: "minimax/minimax-h3",
  displayName: "MiniMax-H3",
  platform: "official",
  source: "litellm",
  currency: "USD",
  kind: "video",
  unit: "per_second",
  input: 0.04,
  output: 0.08,
  tiers: [
    { label: "768p", output: 0.08 },
    { label: "2k", output: 0.13 },
  ],
  modalities: ["text"],
  isFree: false,
  stale: false,
  status: "active",
  missingDays: 0,
  sourceUrl: "https://www.minimax.io/price",
  notes: null,
  firstSeenAt: "2026-10-18",
  fetchedAt: "2026-10-18T00:00:00Z",
  publishedAt: "2026-10-18T00:00:00Z",
};

describe("视频/图像 schema", () => {
  it("SCHEMA_VERSION 升到 1.1.x（只做了加法）", () => {
    expect(SCHEMA_VERSION).toMatch(/^1\.1\.\d+$/);
  });

  it("MediaOffering 与 MediaLatestFile 能通过校验", () => {
    expect(MediaOfferingSchema.parse(OFFERING)).toEqual(OFFERING);
    const file = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: "2026-10-18T00:00:00Z",
      dataDate: "2026-10-18",
      offerings: [OFFERING],
    };
    expect(MediaLatestFileSchema.safeParse(file).success).toBe(true);
  });

  it("拒绝未知的计费单位和负价格", () => {
    expect(MediaOfferingSchema.safeParse({ ...OFFERING, unit: "per_minute" }).success).toBe(false);
    expect(MediaOfferingSchema.safeParse({ ...OFFERING, output: -1 }).success).toBe(false);
    const badTier = { ...OFFERING, tiers: [{ label: "", output: 1 }] };
    expect(MediaOfferingSchema.safeParse(badTier).success).toBe(false);
  });

  it("RawMediaOffering 必须带 media.kind / media.unit", () => {
    const raw = {
      vendorHint: "minimax",
      modelName: "MiniMax-H3",
      currency: "USD",
      media: { kind: "video", unit: "per_second" },
      input: 0.04,
      output: 0.08,
      sourceUrl: "https://www.minimax.io/price",
    };
    expect(RawMediaOfferingSchema.safeParse(raw).success).toBe(true);
    expect(RawMediaOfferingSchema.safeParse({ ...raw, media: undefined }).success).toBe(false);
  });

  it("status.json 的 mediaOfferingCount 是可选字段（旧文件仍然合法）", () => {
    const source = {
      id: "litellm",
      kind: "api",
      status: "ok",
      offeringCount: 3,
      durationMs: 10,
      errorCode: null,
      errorMessage: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
    };
    const run = {
      id: "r",
      startedAt: "2026-10-18T00:00:00Z",
      finishedAt: "2026-10-18T00:00:00Z",
      durationMs: 0,
      result: "success",
    };
    const status = { run, sources: [source], quarantine: [], warnings: [] };
    expect(StatusFileSchema.safeParse(status).success).toBe(true);
    const withMedia = { ...status, sources: [{ ...source, mediaOfferingCount: 2 }] };
    expect(StatusFileSchema.safeParse(withMedia).success).toBe(true);
  });
});

describe("视频/图像价格格式", () => {
  it("单位后缀随语言变化", () => {
    expect(mediaUnitSuffix("per_second")).toBe("/秒");
    expect(mediaUnitSuffix("per_image", "en")).toBe("/image");
  });

  it("价格带单位；null 和免费不加单位", () => {
    expect(formatMediaPrice(0.08, "USD", "per_second")).toBe("$0.0800/秒");
    expect(formatMediaPrice(1.5, "CNY", "per_image", { locale: "en", approx: true })).toBe(
      "≈ ¥1.50/image",
    );
    expect(formatMediaPrice(null, "USD", "per_second")).toBe("—");
    expect(formatMediaPrice(0, "USD", "per_image", { locale: "en" })).toBe("Free");
  });
});
