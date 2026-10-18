import type { HistoryFile } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { appendPoint, historyRelativePath, planHistoryUpdates } from "../../src/steps/history";
import { makeOffering, TODAY } from "../helpers";

const point = (effectiveDate: string, input: number) => ({
  effectiveDate,
  input,
  output: 10,
  cacheRead: null,
  cacheWrite: null,
});

describe("history", () => {
  it("路径为 history/<vendor>/<model>.json", () => {
    expect(historyRelativePath("openai/gpt-4o")).toBe("history/openai/gpt-4o.json");
  });

  it("价格变化时追加变更点；没变时不追加", () => {
    const series = [point("2026-10-01", 2.5)];
    expect(appendPoint(series, makeOffering({ input: 2.5 }), TODAY)).toBe(series);
    expect(appendPoint(series, makeOffering({ input: 2 }), TODAY)).toEqual([
      point("2026-10-01", 2.5),
      point(TODAY, 2),
    ]);
    expect(appendPoint([], makeOffering({ input: 2 }), TODAY)).toEqual([point(TODAY, 2)]);
  });

  it("同一天再次变化：替换当天的点；改回原价时删除当天的点", () => {
    const series = [point("2026-10-01", 2.5), point(TODAY, 2)];
    expect(appendPoint(series, makeOffering({ input: 1.5 }), TODAY)).toEqual([
      point("2026-10-01", 2.5),
      point(TODAY, 1.5),
    ]);
    expect(appendPoint(series, makeOffering({ input: 2.5 }), TODAY)).toEqual([
      point("2026-10-01", 2.5),
    ]);
    expect(appendPoint([point(TODAY, 2)], makeOffering({ input: 3 }), TODAY)).toEqual([
      point(TODAY, 3),
    ]);
  });

  it("planHistoryUpdates 只返回有变化的文件，同一模型的多个平台放在一个文件里", () => {
    const official = makeOffering({ input: 2.5 });
    const openrouter = makeOffering({
      id: "openrouter:openai/gpt-4o",
      platform: "openrouter",
      source: "openrouter",
      input: 2.6,
    });
    const unchanged: HistoryFile = {
      modelSlug: "openai/gpt-4o",
      series: { [official.id]: [point("2026-10-01", 2.5)] },
    };
    const result = planHistoryUpdates({
      offerings: [official, openrouter],
      existing: new Map([["openai/gpt-4o", unchanged]]),
      today: TODAY,
    });
    expect([...result.keys()]).toEqual(["openai/gpt-4o"]);
    expect(Object.keys(result.get("openai/gpt-4o")?.series ?? {})).toEqual([
      official.id,
      openrouter.id,
    ]);

    const noChange = planHistoryUpdates({
      offerings: [official],
      existing: new Map([["openai/gpt-4o", unchanged]]),
      today: TODAY,
    });
    expect(noChange.size).toBe(0);
  });

  it("已下架和过期（stale）的 Offering 不追加", () => {
    const result = planHistoryUpdates({
      offerings: [
        makeOffering({ status: "removed" }),
        makeOffering({ id: "x:openai/b", model: "b", modelSlug: "openai/b", stale: true }),
      ],
      existing: new Map(),
      today: TODAY,
    });
    expect(result.size).toBe(0);
  });
});
