import type { Override, QuarantineEntry } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  applyPin,
  changedPriceFields,
  decidePrice,
  isAnomalous,
  type PriceDecisionInput,
} from "../../src/steps/quarantine";
import { NOW_ISO } from "../helpers";

const published = {
  currency: "USD" as const,
  input: 10,
  output: 30,
  cacheRead: null,
  cacheWrite: null,
};

function input(overrides: Partial<PriceDecisionInput> = {}): PriceDecisionInput {
  return {
    offeringId: "official:openai/gpt-4o",
    candidate: published,
    published,
    entry: null,
    override: null,
    threshold: 0.8,
    nowIso: NOW_ISO,
    ...overrides,
  };
}

const dropped = { ...published, input: 1 }; // -90%

function entry(candidate = dropped, confirmations = 1): QuarantineEntry {
  return {
    offeringId: "official:openai/gpt-4o",
    fields: [{ field: "input", old: 10, new: candidate.input, pct: -0.9 }],
    candidate: {
      input: candidate.input,
      output: candidate.output,
      cacheRead: null,
      cacheWrite: null,
    },
    firstSeenAt: "2026-10-17T00:00:00Z",
    lastSeenAt: "2026-10-17T00:00:00Z",
    confirmations,
  };
}

const override = (action: Override["action"], price?: Override["price"]): Override => ({
  offering: "official:openai/gpt-4o",
  action,
  until: "2026-11-01",
  reason: "测试",
  ...(price ? { price } : {}),
});

describe("隔离区状态机", () => {
  it("价格不变或小幅变动：直接放行", () => {
    expect(decidePrice(input())).toEqual({ kind: "accept", confirmedFromQuarantine: false });
    expect(decidePrice(input({ candidate: { ...published, input: 5 } }))).toEqual({
      kind: "accept",
      confirmedFromQuarantine: false,
    });
  });

  it("新模型、币种变化：没有可比的旧值，直接放行", () => {
    expect(decidePrice(input({ published: null, candidate: dropped })).kind).toBe("accept");
    expect(decidePrice(input({ candidate: { ...dropped, currency: "CNY" } })).kind).toBe("accept");
  });

  it("V3：单日变动 > 80%（涨跌都算）进入隔离区", () => {
    const down = decidePrice(input({ candidate: dropped }));
    expect(down).toMatchObject({
      kind: "hold",
      isNewEntry: true,
      entry: { confirmations: 1, firstSeenAt: NOW_ISO },
    });
    if (down.kind === "hold")
      expect(down.entry.fields).toEqual([{ field: "input", old: 10, new: 1, pct: -0.9 }]);
    const up = decidePrice(input({ candidate: { ...published, output: 60 } }));
    expect(up.kind).toBe("hold");
  });

  it("V4：连续 2 次抓到同一新值 → 放行并标记 confirmedFromQuarantine", () => {
    expect(decidePrice(input({ candidate: dropped, entry: entry() }))).toEqual({
      kind: "accept",
      confirmedFromQuarantine: true,
    });
  });

  it("隔离中抓回旧值：丢弃候选，正常放行旧值", () => {
    expect(decidePrice(input({ entry: entry() }))).toEqual({
      kind: "accept",
      confirmedFromQuarantine: false,
    });
  });

  it("隔离中抓到另一个新值：重新计数", () => {
    const other = { ...published, input: 0.5 };
    const result = decidePrice(input({ candidate: other, entry: entry() }));
    expect(result).toMatchObject({
      kind: "hold",
      isNewEntry: true,
      entry: { confirmations: 1, candidate: { input: 0.5 } },
    });
  });

  it("V8 approve：提前放行（有隔离条目时标记已确认）", () => {
    expect(decidePrice(input({ candidate: dropped, override: override("approve") }))).toEqual({
      kind: "accept",
      confirmedFromQuarantine: false,
    });
    expect(
      decidePrice(input({ candidate: dropped, entry: entry(), override: override("approve") })),
    ).toEqual({
      kind: "accept",
      confirmedFromQuarantine: true,
    });
  });

  it("V8 block / pin", () => {
    expect(decidePrice(input({ candidate: dropped, override: override("block") }))).toEqual({
      kind: "block",
    });
    expect(
      decidePrice(input({ candidate: dropped, override: override("pin", { input: 8 }) })),
    ).toEqual({
      kind: "pin",
      prices: { input: 8, output: 30, cacheRead: null, cacheWrite: null },
    });
  });

  it("applyPin 只替换写了的字段", () => {
    expect(
      applyPin(
        { input: 1, output: 2, cacheRead: 3, cacheWrite: null },
        { output: null, cacheRead: undefined },
      ),
    ).toEqual({
      input: 1,
      output: null,
      cacheRead: 3,
      cacheWrite: null,
    });
  });

  it("changedPriceFields / isAnomalous：null ↔ 数值的变化不算突变", () => {
    const fields = changedPriceFields(
      { input: 1, output: 2, cacheRead: null, cacheWrite: 0 },
      { input: 1.00001, output: 3, cacheRead: 0.1, cacheWrite: 5 },
    );
    expect(fields.map((f) => f.field)).toEqual(["output", "cacheRead", "cacheWrite"]);
    expect(isAnomalous(fields, 0.8)).toBe(false);
    expect(isAnomalous([{ field: "input", old: 1, new: 2, pct: 1 }], 0.8)).toBe(true);
  });
});
