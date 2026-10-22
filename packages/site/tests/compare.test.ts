import { describe, expect, it } from "vitest";
import {
  MAX_COMPARE,
  cleanSlugs,
  compareColumns,
  compareSearch,
  isModelSlug,
  parseCompareSearch,
  parseStoredSlugs,
  toggleSlug,
} from "../src/lib/compare";
import { toTableRow } from "../src/lib/site-model";
import type { TableRow } from "../src/lib/table";
import { fixtureModel } from "./helpers";

const model = fixtureModel();
const rows: readonly TableRow[] = model.offerings.map((o) => toTableRow(model, o, "zh"));

function row(id: string, slug: string, platform: string, usd: TableRow["usd"]): TableRow {
  const base = rows[0];
  if (!base) throw new Error("fixture");
  return {
    ...base,
    id,
    modelSlug: slug,
    platform,
    platformName: platform,
    usd,
    blendedUsd: usd[0] === null || usd[1] === null ? null : (usd[0] * 3 + usd[1]) / 4,
    isFree: false,
    contextWindow: 1000,
  };
}

describe("slug 校验与列表操作", () => {
  it("只接受 vendor/model 形式", () => {
    expect(isModelSlug("openai/gpt-5")).toBe(true);
    expect(isModelSlug("zhipu/glm-4.5-air:free")).toBe(true);
    expect(isModelSlug("gpt-5")).toBe(false);
    expect(isModelSlug("<script>/x")).toBe(false);
    expect(isModelSlug(42)).toBe(false);
    expect(isModelSlug(`a/${"x".repeat(300)}`)).toBe(false);
  });

  it("cleanSlugs 去重、丢弃非法项、截断到上限", () => {
    expect(cleanSlugs(["a/b", "a/b", "bad", "c/d", "e/f"], 2)).toEqual(["a/b", "c/d"]);
  });

  it("parseStoredSlugs 容忍损坏的 localStorage", () => {
    expect(parseStoredSlugs(null, 4)).toEqual([]);
    expect(parseStoredSlugs("{not json", 4)).toEqual([]);
    expect(parseStoredSlugs('{"a":1}', 4)).toEqual([]);
    expect(parseStoredSlugs('["a/b",1,"c/d"]', 4)).toEqual(["a/b", "c/d"]);
  });

  it("toggleSlug 不修改原数组，满了不再追加", () => {
    const list = ["a/1", "a/2"];
    expect(toggleSlug(list, "a/3", 4)).toEqual(["a/1", "a/2", "a/3"]);
    expect(toggleSlug(list, "a/1", 4)).toEqual(["a/2"]);
    expect(list).toEqual(["a/1", "a/2"]);
    const full = ["a/1", "a/2", "a/3", "a/4"];
    expect(toggleSlug(full, "a/5", MAX_COMPARE)).toBe(full);
    expect(toggleSlug(list, "bad", 4)).toBe(list);
  });
});

describe("对比链接", () => {
  it("往返一致，最多 4 个", () => {
    const slugs = ["openai/gpt-5", "deepseek/deepseek-v4-pro"];
    const search = compareSearch(slugs);
    expect(search).toBe("?m=openai/gpt-5,deepseek/deepseek-v4-pro");
    expect(parseCompareSearch(search)).toEqual(slugs);
    expect(parseCompareSearch("?m=a/1,a/2,a/3,a/4,a/5")).toHaveLength(4);
    expect(parseCompareSearch("")).toEqual([]);
    expect(compareSearch([])).toBe("");
  });
});

describe("compareColumns", () => {
  const data = [
    row("official:x/a", "x/a", "official", [2, 8, 0.5]),
    row("openrouter:x/a", "x/a", "openrouter", [1.5, 9, null]),
    row("azure:x/a", "x/a", "azure", [3, 6, 0.2]),
    row("official:y/b", "y/b", "official", [1, 2, null]),
  ];

  it("按 slugs 顺序输出，各项最低价分别取", () => {
    const { columns, missing } = compareColumns(data, ["y/b", "x/a", "z/none"]);
    expect(columns.map((c) => c.slug)).toEqual(["y/b", "x/a"]);
    expect(missing).toEqual(["z/none"]);
    const a = columns[1];
    expect(a?.bestInput?.platform).toBe("openrouter");
    expect(a?.bestOutput?.platform).toBe("azure");
    expect(a?.bestCache?.platform).toBe("azure");
    expect(a?.official?.platform).toBe("official");
    expect(a?.platformCount).toBe(3);
    expect(columns[0]?.bestCache).toBeNull();
  });
});
