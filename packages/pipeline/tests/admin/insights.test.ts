import type { ChangeEvent, Offering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  changeTrend,
  duplicateGroups,
  normalizeModelKey,
  rawNameOfferings,
  staleOfferings,
  summarize,
} from "../../src/admin/insights";
import { makeOffering } from "../helpers";

const offer = (o: Partial<Offering>) => makeOffering(o);

function event(id: string, type: ChangeEvent["type"]): ChangeEvent {
  return {
    id,
    type,
    offeringId: "official:openai/gpt-4o",
    vendor: "openai",
    modelSlug: "openai/gpt-4o",
    displayName: "GPT-4o",
    platform: "official",
    currency: "USD",
    fields: [],
    confirmedFromQuarantine: false,
    detectedAt: "2026-10-31T00:00:00Z",
  };
}

describe("summarize：数据概览", () => {
  it("只统计在售报价：模型数、报价数、平台数、厂商数、已下架数", () => {
    const s = summarize([
      offer({ id: "official:openai/a", modelSlug: "openai/a", platform: "official" }),
      offer({ id: "together:openai/a", modelSlug: "openai/a", platform: "together" }),
      offer({ id: "official:deepseek/b", modelSlug: "deepseek/b", vendor: "deepseek" }),
      offer({ id: "official:openai/c", modelSlug: "openai/c", status: "removed" }),
    ]);
    expect(s).toEqual({ models: 2, offerings: 3, platforms: 2, vendors: 2, removed: 1 });
  });
});

describe("changeTrend：每日变动", () => {
  it("按日期汇总最近 N 天各类变动，没有变动的日子补 0，按日期升序", () => {
    const trend = changeTrend(
      [
        event("2026-10-30-a-1", "price_down"),
        event("2026-10-30-b-1", "price_down"),
        event("2026-10-31-c-1", "new_model"),
        event("2026-10-31-d-1", "context_change"),
        event("2026-10-01-e-1", "price_up"),
      ],
      "2026-10-31",
      3,
    );
    expect(trend).toEqual([
      { date: "2026-10-29", price_down: 0, price_up: 0, new_model: 0, removed: 0 },
      { date: "2026-10-30", price_down: 2, price_up: 0, new_model: 0, removed: 0 },
      { date: "2026-10-31", price_down: 0, price_up: 0, new_model: 1, removed: 0 },
    ]);
  });
});

describe("数据质量检查", () => {
  it("rawNameOfferings：展示名就是原始 ID（全小写、没空格）的报价", () => {
    const raw = rawNameOfferings([
      offer({
        id: "x:openai/gpt-6-rosalind",
        model: "gpt-6-rosalind",
        displayName: "gpt-6-rosalind",
      }),
      offer({ id: "x:openai/gpt-4o", model: "gpt-4o", displayName: "GPT-4o" }),
      offer({ id: "y:openai/old", model: "old", displayName: "old", status: "removed" }),
    ]);
    expect(raw.map((o) => o.id)).toEqual(["x:openai/gpt-6-rosalind"]);
  });

  it("normalizeModelKey：2p5 视为 2.5，去掉 -instruct 和标点", () => {
    expect(normalizeModelKey("qwen2p5-7b-instruct")).toBe(normalizeModelKey("qwen2.5-7b-instruct"));
    expect(normalizeModelKey("Llama-3-8B-Instruct")).toBe(normalizeModelKey("llama-3-8b"));
    expect(normalizeModelKey("gpt-4o")).not.toBe(normalizeModelKey("gpt-4o-mini"));
  });

  it("duplicateGroups：同一厂商下归一化后相同的不同模型 ID", () => {
    const groups = duplicateGroups([
      offer({
        id: "a:alibaba/qwen2p5-7b-instruct",
        vendor: "alibaba",
        modelSlug: "alibaba/qwen2p5-7b-instruct",
        model: "qwen2p5-7b-instruct",
      }),
      offer({
        id: "b:alibaba/qwen2.5-7b-instruct",
        vendor: "alibaba",
        modelSlug: "alibaba/qwen2.5-7b-instruct",
        model: "qwen2.5-7b-instruct",
      }),
      offer({
        id: "c:alibaba/qwen2.5-7b-instruct",
        vendor: "alibaba",
        modelSlug: "alibaba/qwen2.5-7b-instruct",
        model: "qwen2.5-7b-instruct",
      }),
      offer({ id: "d:openai/gpt-4o", modelSlug: "openai/gpt-4o", model: "gpt-4o" }),
    ]);
    expect(groups).toEqual([
      { vendor: "alibaba", slugs: ["alibaba/qwen2.5-7b-instruct", "alibaba/qwen2p5-7b-instruct"] },
    ]);
  });

  it("staleOfferings：标记为过期、或连续几天没抓到的在售报价，按缺失天数降序", () => {
    const stale = staleOfferings([
      offer({ id: "a", stale: true, missingDays: 1 }),
      offer({ id: "b", status: "missing", missingDays: 2 }),
      offer({ id: "c" }),
      offer({ id: "d", status: "removed", missingDays: 5 }),
    ]);
    expect(stale.map((o) => o.id)).toEqual(["b", "a"]);
  });
});
