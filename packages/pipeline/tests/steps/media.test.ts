import type { MediaOffering, RawMediaOffering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  buildMediaLatestFile,
  isMediaLatestUnchanged,
  mediaOutcomes,
  toLaneOffering,
  toMediaOffering,
} from "../../src/steps/media-lane";
import { buildMediaLane, isRawMedia } from "../../src/steps/media-normalize";
import { createAliasResolver, createVendorMatcher } from "../../src/steps/normalize";
import type { SourceOutcome } from "../../src/steps/types";
import { exceedsRange, MEDIA_PRICE_LIMIT } from "../../src/steps/validate";
import { makeCandidate, makeOffering, NOW_ISO, TEST_PROVIDERS } from "../helpers";

const ctx = {
  sourceId: "litellm",
  platform: TEST_PROVIDERS.platforms[0] ?? {
    id: "official",
    nameZh: "",
    nameEn: "",
    website: null,
    allowedSourceDomains: [],
  },
  matchVendor: createVendorMatcher(TEST_PROVIDERS),
  resolveAlias: createAliasResolver({}),
};

const raw = (overrides: Partial<RawMediaOffering> = {}): RawMediaOffering => ({
  vendorHint: "openai",
  modelName: "Sora-3",
  currency: "USD",
  media: { kind: "video", unit: "per_second" },
  input: 0.01,
  output: 0.1,
  tiers: [
    { label: "4k", output: 0.5 },
    { label: "720p", output: 0.1 },
  ],
  sourceUrl: "https://openai.com/api/pricing/",
  ...overrides,
});

const MEDIA: MediaOffering = {
  id: "official:openai/sora-3",
  vendor: "openai",
  model: "sora-3",
  modelSlug: "openai/sora-3",
  displayName: "Sora-3",
  platform: "official",
  source: "litellm",
  currency: "USD",
  kind: "video",
  unit: "per_second",
  input: null,
  output: 0.1,
  tiers: [{ label: "720p", output: 0.1 }],
  modalities: ["text"],
  isFree: false,
  stale: false,
  status: "active",
  missingDays: 0,
  sourceUrl: "https://openai.com/api/pricing/",
  notes: null,
  firstSeenAt: "2026-10-01",
  fetchedAt: NOW_ISO,
  publishedAt: NOW_ISO,
};

describe("media-normalize", () => {
  it("isRawMedia：只有 media 是对象时才算视频/图像报价", () => {
    expect(isRawMedia(raw())).toBe(true);
    expect(isRawMedia({ media: null })).toBe(false);
    expect(isRawMedia({ media: "video" })).toBe(false);
    expect(isRawMedia(null)).toBe(false);
    expect(isRawMedia({ unit: "per_token" })).toBe(false);
  });

  it("规范化模型 ID，价格原样保留，档位按价格升序", () => {
    const { lane, warnings } = buildMediaLane({
      raws: [raw()],
      ctx,
      usdCny: 7.1,
      previousCount: 0,
    });
    expect(warnings).toEqual([]);
    expect(lane.state).toBe("ok");
    expect(lane.candidates[0]).toMatchObject({
      id: "official:openai/sora-3",
      input: 0.01,
      output: 0.1,
      cacheRead: null,
      tiers: null,
      contextWindow: null,
      kind: "video",
      unit: "per_second",
      mediaTiers: [
        { label: "720p", output: 0.1 },
        { label: "4k", output: 0.5 },
      ],
    });
  });

  it("V1 / 未知厂商 / 同源重复 / V2 / V5", () => {
    const { lane, warnings } = buildMediaLane({
      raws: [
        raw(),
        raw({ modelName: "sora 3" }), // 规范化后与上一条重复
        raw({ modelName: "x", vendorHint: "nobody" }),
        { ...raw(), media: { kind: "audio", unit: "per_second" } },
        raw({ modelName: "gold", output: 80 }),
        raw({ modelName: "no-tiers", tiers: [] }),
      ],
      ctx,
      usdCny: 7.1,
      previousCount: 0,
    });
    expect(lane.candidates.map((c) => c.model)).toEqual(["sora-3", "no-tiers"]);
    expect(lane.candidates[1]?.mediaTiers).toBeNull();
    expect(lane.invalidIds).toEqual(["official:openai/gold"]);
    expect(warnings.map((w) => w.code).toSorted()).toEqual(["E3001", "E3002", "W2003"]);
    const drop = buildMediaLane({ raws: [raw()], ctx, usdCny: 7.1, previousCount: 10 });
    expect(drop.lane).toMatchObject({ state: "rejected", candidates: [], offeringCount: 1 });
    expect(drop.warnings.at(-1)?.message).toContain("该源的视频/图像报价沿用旧数据");
  });

  it("V2 媒体上限同时检查档位价格", () => {
    const candidate = {
      ...makeCandidate(),
      kind: "video" as const,
      unit: "per_second" as const,
      mediaTiers: [{ label: "8k", output: 60 }],
      input: null,
      output: 1,
    };
    expect(exceedsRange(candidate, 7.1, MEDIA_PRICE_LIMIT)).toBe(true);
    expect(exceedsRange({ ...candidate, mediaTiers: null }, 7.1, MEDIA_PRICE_LIMIT)).toBe(false);
  });
});

describe("media-lane", () => {
  it("MediaOffering ↔ 内部形状可以往返", () => {
    const lane = toLaneOffering(MEDIA);
    expect(lane).toMatchObject({ cacheRead: null, tiers: null, mediaTiers: MEDIA.tiers });
    expect(toMediaOffering(lane)).toEqual(MEDIA);
    expect(toMediaOffering({ ...lane, output: 0, input: null }).isFree).toBe(true);
  });

  it("缺少媒体字段时抛 E4001", () => {
    expect(() => toMediaOffering(makeOffering())).toThrow(/E4001|媒体字段/);
  });

  it("mediaOutcomes：没有 media 线的源沿用自身状态、没有候选", () => {
    const base: SourceOutcome = {
      id: "deepseek",
      kind: "html",
      platform: "official",
      state: "ok",
      candidates: [makeCandidate()],
      offeringCount: 1,
      invalidIds: ["x"],
      durationMs: 1,
      error: null,
      warnings: [],
    };
    const withLane: SourceOutcome = {
      ...base,
      id: "litellm",
      media: { state: "rejected", candidates: [], offeringCount: 0, invalidIds: [] },
    };
    expect(
      mediaOutcomes([base, withLane]).map((o) => [o.id, o.state, o.candidates.length]),
    ).toEqual([
      ["deepseek", "ok", 0],
      ["litellm", "rejected", 0],
    ]);
  });

  it("latest 只有时间戳变化时视为未变", () => {
    const a = buildMediaLatestFile([MEDIA], NOW_ISO, "2026-10-18");
    const b = buildMediaLatestFile(
      [{ ...MEDIA, fetchedAt: "2026-10-19T00:00:00Z" }],
      "2026-10-19T00:00:00Z",
      "2026-10-19",
    );
    expect(isMediaLatestUnchanged(a, b)).toBe(true);
    expect(isMediaLatestUnchanged(a, { ...b, offerings: [{ ...MEDIA, output: 0.2 }] })).toBe(false);
    expect(isMediaLatestUnchanged(null, b)).toBe(false);
  });
});
