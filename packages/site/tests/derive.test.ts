import type { Offering, PricePoint } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { addDays, dateToUnix, hoursBetween } from "../src/lib/dates";
import {
  deriveBlended,
  deriveChange7d,
  deriveConverted,
  primaryChange,
  priceAt,
  toPublicOffering,
} from "../src/lib/derive";
import { fixtureData } from "./helpers";

function offering(overrides: Partial<Offering> = {}): Offering {
  return {
    id: "official:deepseek/deepseek-chat",
    vendor: "deepseek",
    model: "deepseek-chat",
    modelSlug: "deepseek/deepseek-chat",
    displayName: "DeepSeek-V3",
    platform: "official",
    source: "deepseek",
    currency: "CNY",
    input: 2,
    output: 8,
    cacheRead: 0.5,
    cacheWrite: null,
    tiers: null,
    contextWindow: 128000,
    maxOutput: 8192,
    modalities: ["text"],
    isFree: false,
    stale: false,
    status: "active",
    missingDays: 0,
    sourceUrl: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
    notes: null,
    firstSeenAt: "2026-07-01",
    fetchedAt: "2026-10-18T00:01:33Z",
    publishedAt: "2026-10-18T00:04:12Z",
    ...overrides,
  };
}

const point = (effectiveDate: string, input: number | null, output: number | null): PricePoint => ({
  effectiveDate,
  input,
  output,
  cacheRead: null,
  cacheWrite: null,
});

describe("dates", () => {
  it("日期加减", () => {
    expect(addDays("2026-10-18", -7)).toBe("2026-10-11");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("北京时间零点转 Unix 秒", () => {
    expect(dateToUnix("2026-10-18")).toBe(Date.parse("2026-10-17T16:00:00Z") / 1000);
    expect(hoursBetween("2026-10-18T00:00:00Z", "2026-10-18T12:00:00Z")).toBe(12);
  });
});

describe("derive", () => {
  it("按汇率换算成 USD 和 CNY", () => {
    const converted = deriveConverted(offering(), 8);
    expect(converted.cny).toEqual({ input: 2, output: 8, cacheRead: 0.5, cacheWrite: null });
    expect(converted.usd).toEqual({ input: 0.25, output: 1, cacheRead: 0.0625, cacheWrite: null });
  });

  it("混合价 = (3 × 输入 + 输出) / 4；缺失时为 null", () => {
    expect(deriveBlended(deriveConverted(offering(), 8))).toEqual({ usd: 0.4375, cny: 3.5 });
    expect(deriveBlended(deriveConverted(offering({ output: null }), 8))).toBeNull();
  });

  it("变更点序列里取某天生效的价格", () => {
    const series = [point("2026-07-01", 2, 16), point("2026-10-12", 2, 8)];
    expect(priceAt(series, "2026-06-30")).toBeNull();
    expect(priceAt(series, "2026-10-11")?.output).toBe(16);
    expect(priceAt(series, "2026-10-12")?.output).toBe(8);
  });

  it("7 日变化：降价 50% 记为 -0.5，没变的字段为 0", () => {
    const series = [point("2026-07-01", 2, 16), point("2026-10-12", 2, 8)];
    expect(deriveChange7d(offering(), series, "2026-10-18")).toEqual({ input: 0, output: -0.5 });
  });

  it("7 天前还没有这个报价或没有历史时为 null", () => {
    expect(deriveChange7d(offering(), [point("2026-10-15", 2, 8)], "2026-10-18")).toBeNull();
    expect(deriveChange7d(offering(), undefined, "2026-10-18")).toBeNull();
    expect(deriveChange7d(offering(), [], "2026-10-18")).toBeNull();
  });

  it("旧值为 null 或 0 时该字段为 null", () => {
    const series = [point("2026-07-01", null, 0)];
    expect(deriveChange7d(offering(), series, "2026-10-18")).toEqual({ input: null, output: null });
  });

  it("primaryChange 取绝对值最大的变化", () => {
    expect(primaryChange({ input: 0, output: -0.5 })).toBe(-0.5);
    expect(primaryChange({ input: 0.2, output: -0.1 })).toBe(0.2);
    expect(primaryChange({ input: null, output: null })).toBeNull();
    expect(primaryChange(null)).toBeNull();
  });

  it("生成的公开 Offering 只包含文档列出的字段", () => {
    const data = fixtureData();
    const raw = data.latest?.offerings.find((o) => o.id === "official:deepseek/deepseek-chat");
    if (!raw) throw new Error("fixture 缺少 deepseek-chat");
    const pub = toPublicOffering(raw, {
      usdCny: 7.1,
      dataDate: "2026-10-18",
      histories: data.histories,
    });
    expect(Object.keys(pub).toSorted()).toEqual(
      [
        "id",
        "vendor",
        "model",
        "modelSlug",
        "displayName",
        "platform",
        "source",
        "currency",
        "input",
        "output",
        "cacheRead",
        "cacheWrite",
        "tiers",
        "converted",
        "blended",
        "contextWindow",
        "maxOutput",
        "isFree",
        "stale",
        "status",
        "change7d",
        "sourceUrl",
        "notes",
        "fetchedAt",
        "publishedAt",
      ].toSorted(),
    );
    expect(pub.change7d).toEqual({ input: 0, output: -0.5 });
    expect(pub.converted.cny.output).toBe(8);
  });
});
