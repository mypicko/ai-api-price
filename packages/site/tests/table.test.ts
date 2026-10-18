import { describe, expect, it } from "vitest";
import { toTableRow } from "../src/lib/site-model";
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  ariaSort,
  filterRows,
  isDefaultFilters,
  modelOptions,
  pruneModels,
  nextSort,
  parseTableState,
  pricesFor,
  serializeTableState,
  sortRows,
  type TableRow,
} from "../src/lib/table";
import { fixtureModel } from "./helpers";

const model = fixtureModel();
const rows: readonly TableRow[] = model.offerings.map((o) => toTableRow(model, o, "zh"));

describe("table 排序", () => {
  it("默认按混合价升序，免费和空值排在付费模型之后", () => {
    const sorted = sortRows(rows, DEFAULT_SORT);
    const paid = sorted.filter((r) => !r.isFree && r.blendedUsd !== null);
    const values = paid.map((r) => r.blendedUsd ?? 0);
    expect(values).toEqual(values.toSorted((a, b) => a - b));
    expect(sorted.slice(0, paid.length)).toEqual(paid);
    expect(sorted[0]?.isFree).toBe(false);
    expect(sorted.some((r) => r.isFree)).toBe(true);
  });

  it("降序时空值仍然排最后", () => {
    const sorted = sortRows(rows, { key: "output", dir: "desc" });
    expect(sorted[0]?.displayName).toBe("Claude Opus 4.1");
    expect(sorted.at(-1)?.usd[1]).toBeNull();
  });

  it("文字列按名称排序，不修改原数组", () => {
    const before = rows.map((r) => r.id);
    const sorted = sortRows(rows, { key: "vendor", dir: "asc" });
    expect(
      (sorted[0]?.vendorName.toLowerCase() ?? "") <= (sorted[1]?.vendorName.toLowerCase() ?? ""),
    ).toBe(true);
    expect(rows.map((r) => r.id)).toEqual(before);
    for (const key of [
      "model",
      "platform",
      "input",
      "cacheRead",
      "context",
      "change7d",
      "updated",
    ] as const) {
      expect(sortRows(rows, { key, dir: "asc" })).toHaveLength(rows.length);
    }
  });

  it("点击表头：升序 → 降序 → 默认", () => {
    const first = nextSort(DEFAULT_SORT, "input");
    expect(first).toEqual({ key: "input", dir: "asc" });
    const second = nextSort(first, "input");
    expect(second).toEqual({ key: "input", dir: "desc" });
    expect(nextSort(second, "input")).toEqual(DEFAULT_SORT);
    expect(ariaSort(second, "input")).toBe("descending");
    expect(ariaSort(first, "input")).toBe("ascending");
    expect(ariaSort(first, "output")).toBe("none");
  });
});

describe("table 筛选", () => {
  it("搜索：多个词都要匹配，不区分大小写", () => {
    expect(
      filterRows(rows, { ...DEFAULT_FILTERS, q: "DEEPSEEK v3" })
        .map((r) => r.platform)
        .toSorted(),
    ).toEqual(["official", "openrouter", "siliconflow"]);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, q: "   " })).toHaveLength(rows.length);
  });

  it("按厂商、地区、平台、免费、上下文筛选", () => {
    expect(
      filterRows(rows, { ...DEFAULT_FILTERS, vendors: ["openai", "anthropic"] }).every((r) =>
        ["openai", "anthropic"].includes(r.vendor),
      ),
    ).toBe(true);
    expect(
      filterRows(rows, { ...DEFAULT_FILTERS, region: "cn" }).every((r) => r.region === "cn"),
    ).toBe(true);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, platform: "siliconflow" })).toHaveLength(3);
    expect(filterRows(rows, { ...DEFAULT_FILTERS, freeOnly: true }).every((r) => r.isFree)).toBe(
      true,
    );
    expect(
      filterRows(rows, { ...DEFAULT_FILTERS, minContext: 1_000_000 }).every(
        (r) => (r.contextWindow ?? 0) >= 1_000_000,
      ),
    ).toBe(true);
  });

  it("判断是否为默认筛选", () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, freeOnly: true })).toBe(false);
  });

  it("按币种取价格", () => {
    const row = rows.find((r) => r.id === "official:deepseek/deepseek-chat");
    expect(row && pricesFor(row, "CNY")[1]).toBe(8);
    expect(row && pricesFor(row, "USD")[1]).toBeLessThan(2);
  });
});

describe("table URL 参数", () => {
  it("状态和查询参数互相转换", () => {
    const state = {
      filters: {
        q: "qwen",
        vendors: ["alibaba", "zhipu"],
        models: ["alibaba/qwen-plus", "zhipu/glm-4.6"],
        region: "cn" as const,
        platform: "official",
        freeOnly: true,
        minContext: 128000,
      },
      sort: { key: "input" as const, dir: "desc" as const },
    };
    const query = serializeTableState(state);
    expect(query).toBe(
      "q=qwen&vendor=alibaba%2Czhipu&model=alibaba%2Fqwen-plus%2Czhipu%2Fglm-4.6&region=cn&platform=official&free=1&ctx=128000&sort=input&dir=desc",
    );
    expect(parseTableState(`?${query}`)).toEqual(state);
  });

  it("默认状态生成空查询", () => {
    expect(serializeTableState({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT })).toBe("");
    expect(parseTableState("")).toEqual({ filters: DEFAULT_FILTERS, sort: DEFAULT_SORT });
  });

  it("忽略非法参数", () => {
    const state = parseTableState(
      "?vendor=OpenAI,<x>,deepseek,deepseek&model=a/b,../x,nope,a/b&region=eu&platform=../x&ctx=-1&sort=hack&free=yes",
    );
    expect(state.filters.vendors).toEqual(["deepseek"]);
    expect(state.filters.models).toEqual(["a/b"]);
    expect(state.filters.region).toBe("all");
    expect(state.filters.platform).toBe("all");
    expect(state.filters.minContext).toBeNull();
    expect(state.filters.freeOnly).toBe(false);
    expect(state.sort).toEqual(DEFAULT_SORT);
    expect(parseTableState(`?q=${"a".repeat(300)}`).filters.q).toHaveLength(100);
  });
});

describe("模型筛选", () => {
  const someSlug = rows[0]?.modelSlug ?? "";

  it("只保留选中模型的全部平台报价", () => {
    const result = filterRows(rows, { ...DEFAULT_FILTERS, models: [someSlug] });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.modelSlug === someSlug)).toBe(true);
    expect(result).toHaveLength(rows.filter((r) => r.modelSlug === someSlug).length);
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, models: [someSlug] })).toBe(false);
  });

  it("模型选项去重，按厂商和名称排序，并跟随已选厂商", () => {
    const all = modelOptions(rows, [], "zh");
    const slugs = all.map((o) => o.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.toSorted()).toEqual([...new Set(rows.map((r) => r.modelSlug))].toSorted());
    const keys = all.map((o) => `${o.hint}\u0000${o.name}`);
    expect(keys).toEqual(keys.toSorted((a, b) => a.localeCompare(b, "zh")));
    const onlyOpenai = modelOptions(rows, ["openai"], "zh");
    expect(onlyOpenai.length).toBeGreaterThan(0);
    expect(onlyOpenai.every((o) => o.id.startsWith("openai/"))).toBe(true);
  });

  it("切换厂商时去掉不属于这些厂商的已选模型", () => {
    expect(pruneModels(["openai/gpt-4o", "zhipu/glm-4.6"], ["openai"])).toEqual(["openai/gpt-4o"]);
    expect(pruneModels(["openai/gpt-4o"], [])).toEqual(["openai/gpt-4o"]);
  });
});
