import type { ChangeEvent } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { classifyPriceChange, diffOfferings, type DiffInput } from "../../src/steps/diff";
import { makeOffering, NOW_ISO, TODAY } from "../helpers";

const ID = "official:openai/gpt-4o";

function diff(overrides: Partial<DiffInput>): readonly ChangeEvent[] {
  return diffOfferings({
    previous: [],
    next: [],
    confirmed: new Set(),
    nowIso: NOW_ISO,
    today: TODAY,
    existingEvents: [],
    ...overrides,
  });
}

describe("diff", () => {
  it("新出现的 Offering 生成 new_model 事件", () => {
    const events = diff({ next: [makeOffering()] });
    expect(events).toEqual([
      {
        id: `${TODAY}-${ID}-1`,
        type: "new_model",
        offeringId: ID,
        vendor: "openai",
        modelSlug: "openai/gpt-4o",
        displayName: "gpt-4o",
        platform: "official",
        currency: "USD",
        fields: [],
        confirmedFromQuarantine: false,
        detectedAt: NOW_ISO,
      },
    ]);
  });

  it("价格下降时生成 price_down 事件", () => {
    const events = diff({
      previous: [makeOffering({ output: 16 })],
      next: [makeOffering({ output: 8 })],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "price_down",
      fields: [{ field: "output", old: 16, new: 8, pct: -0.5 }],
    });
  });

  it("多个字段变化合并成一个事件；有涨有降归为 price_up", () => {
    const events = diff({
      previous: [makeOffering({ input: 2, output: 8 })],
      next: [makeOffering({ input: 1, output: 10 })],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("price_up");
    expect(events[0]?.fields.map((f) => f.field)).toEqual(["input", "output"]);
  });

  it("浮点误差（< 0.01%）不算变化", () => {
    expect(
      diff({
        previous: [makeOffering({ input: 0.15 })],
        next: [makeOffering({ input: 0.15000000000000002 })],
      }),
    ).toEqual([]);
  });

  it("只有 null ↔ 数值的变化不生成价格事件", () => {
    expect(
      diff({
        previous: [makeOffering({ cacheRead: null })],
        next: [makeOffering({ cacheRead: 1 })],
      }),
    ).toEqual([]);
    expect(classifyPriceChange([{ field: "cacheRead", old: null, new: 1, pct: null }])).toBeNull();
  });

  it("币种变化（换了数据源）不生成价格事件", () => {
    expect(
      diff({
        previous: [makeOffering({ input: 2 })],
        next: [makeOffering({ input: 14, currency: "CNY" })],
      }),
    ).toEqual([]);
  });

  it("下架 / 重新上架", () => {
    expect(
      diff({
        previous: [makeOffering({ status: "missing" })],
        next: [makeOffering({ status: "removed" })],
      })[0]?.type,
    ).toBe("removed");
    expect(
      diff({
        previous: [makeOffering({ status: "removed" })],
        next: [makeOffering({ input: 1 })],
      })[0]?.type,
    ).toBe("restored");
    expect(
      diff({
        previous: [makeOffering({ status: "removed" })],
        next: [makeOffering({ status: "removed" })],
      }),
    ).toEqual([]);
    expect(diff({ next: [makeOffering({ status: "removed" })] })).toEqual([]);
  });

  it("missing 期间不生成事件", () => {
    expect(
      diff({
        previous: [makeOffering()],
        next: [makeOffering({ status: "missing", missingDays: 1 })],
      }),
    ).toEqual([]);
  });

  it("上下文长度变化生成单独的 context_change 事件", () => {
    const events = diff({
      previous: [makeOffering({ contextWindow: 128000, output: 10 })],
      next: [makeOffering({ contextWindow: 200000, output: 5 })],
    });
    expect(events.map((e) => [e.type, e.id])).toEqual([
      ["price_down", `${TODAY}-${ID}-1`],
      ["context_change", `${TODAY}-${ID}-2`],
    ]);
    expect(events[1]?.fields).toEqual([
      { field: "contextWindow", old: 128000, new: 200000, pct: 0.5625 },
    ]);
  });

  it("隔离区放行的价格事件标记 confirmedFromQuarantine", () => {
    const events = diff({
      previous: [makeOffering({ input: 10 })],
      next: [makeOffering({ input: 1 })],
      confirmed: new Set([ID]),
    });
    expect(events[0]?.confirmedFromQuarantine).toBe(true);
  });

  it("同一天再次运行时序号接着当月已有事件递增", () => {
    const existing = diff({ next: [makeOffering()] });
    const events = diff({
      previous: [makeOffering({ input: 10 })],
      next: [makeOffering({ input: 9 })],
      existingEvents: existing,
    });
    expect(events[0]?.id).toBe(`${TODAY}-${ID}-2`);
  });
});
