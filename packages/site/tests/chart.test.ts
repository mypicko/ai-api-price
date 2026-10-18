import { describe, expect, it } from "vitest";
import {
  buildChartData,
  changeAt,
  earliestDate,
  isUnchanged,
  type ChartOffering,
} from "../src/lib/chart";
import { dateToUnix } from "../src/lib/dates";

const p = (effectiveDate: string, input: number | null, output: number | null) => ({
  effectiveDate,
  input,
  output,
  cacheRead: null,
  cacheWrite: null,
});

const official: ChartOffering = {
  id: "official:deepseek/deepseek-chat",
  label: "官方",
  currency: "CNY",
  points: [p("2026-07-01", 2, 16), p("2026-10-12", 2, 8)],
};
const openrouter: ChartOffering = {
  id: "openrouter:deepseek/deepseek-chat",
  label: "OpenRouter",
  currency: "USD",
  points: [p("2026-08-01", 0.3, 1.2)],
};

describe("chart", () => {
  it("合并所有变更日期并延续到 endDate", () => {
    const data = buildChartData([official, openrouter], {
      currency: "CNY",
      usdCny: 7,
      endDate: "2026-10-18",
      range: "all",
    });
    expect(data.dates).toEqual(["2026-07-01", "2026-08-01", "2026-10-12", "2026-10-18"]);
    expect(data.xs[0]).toBe(dateToUnix("2026-07-01"));
    const officialOutput = data.series.find(
      (s) => s.offeringId === official.id && s.field === "output",
    );
    expect(officialOutput?.values).toEqual([16, 16, 8, 8]);
    expect(officialOutput?.changeIndexes).toEqual([2]);
    expect(officialOutput && changeAt(officialOutput, 2)).toBe(-0.5);
    expect(officialOutput && changeAt(officialOutput, 0)).toBeNull();
  });

  it("出现之前为 null，并换算成所选币种", () => {
    const data = buildChartData([official, openrouter], {
      currency: "CNY",
      usdCny: 7,
      endDate: "2026-10-18",
      range: "all",
    });
    const orInput = data.series.find((s) => s.offeringId === openrouter.id && s.field === "input");
    expect(orInput?.values[0]).toBeNull();
    expect(orInput?.values[1]).toBe(2.1);
    expect(orInput?.colorIndex).toBe(1);
  });

  it("时间范围：从范围起点开始，起点取当时生效的价格", () => {
    const data = buildChartData([official], {
      currency: "CNY",
      usdCny: 7,
      endDate: "2026-10-18",
      range: "30d",
    });
    expect(data.dates).toEqual(["2026-09-18", "2026-10-12", "2026-10-18"]);
    expect(data.series.find((s) => s.field === "output")?.values).toEqual([16, 8, 8]);
    const all = buildChartData([official], {
      currency: "CNY",
      usdCny: 7,
      endDate: "2026-10-18",
      range: "1y",
    });
    expect(all.dates[0]).toBe("2026-07-01");
    expect(
      buildChartData([official], {
        currency: "CNY",
        usdCny: 7,
        endDate: "2026-10-18",
        range: "90d",
      }).dates[0],
    ).toBe("2026-07-20");
  });

  it("没有数据或只有一个点", () => {
    expect(
      buildChartData([], { currency: "USD", usdCny: 7, endDate: "2026-10-18", range: "all" })
        .series,
    ).toEqual([]);
    expect(isUnchanged([openrouter])).toBe(true);
    expect(isUnchanged([official, openrouter])).toBe(false);
    expect(earliestDate([openrouter, official])).toBe("2026-07-01");
    expect(earliestDate([])).toBeNull();
  });
});
