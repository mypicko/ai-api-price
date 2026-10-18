import { describe, expect, it } from "vitest";
import { groupByModel, sortGroups } from "../src/lib/aggregate";
import { packRows, unpackRows } from "../src/lib/pack";
import { toTableRow } from "../src/lib/site-model";
import { DEFAULT_SORT, type TableRow } from "../src/lib/table";
import { fixtureModel } from "./helpers";

const model = fixtureModel();
const rows: readonly TableRow[] = model.offerings.map((o) => toTableRow(model, o, "zh"));

function row(
  id: string,
  slug: string,
  platform: string,
  blendedUsd: number | null,
  extra: Partial<TableRow> = {},
): TableRow {
  const base = rows[0];
  if (!base) throw new Error("fixture");
  return {
    ...base,
    id,
    modelSlug: slug,
    platform,
    platformName: platform,
    blendedUsd,
    isFree: false,
    ...extra,
  };
}

describe("pack：按列 + 字典打包，还原后完全一致", () => {
  it("往返无损，重复字符串只存一次", () => {
    const packed = packRows(rows);
    expect(unpackRows<TableRow>(packed)).toEqual(rows);
    expect(packed.count).toBe(rows.length);
    expect(new Set(packed.dict).size).toBe(packed.dict.length);
    const platformCol = packed.keys.indexOf("platformName");
    expect(packed.kinds[platformCol]).toBe("dict");
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(rows).length);
  });

  it("空数组", () => {
    expect(unpackRows(packRows([]))).toEqual([]);
  });
});

describe("aggregate：按模型聚合", () => {
  const sample = [
    row("a:x/m1", "x/m1", "official", 2),
    row("b:x/m1", "x/m1", "azure", 1.5),
    row("c:x/m1", "x/m1", "groq", null),
    row("d:x/m1", "x/m1", "free", 0, { isFree: true }),
    row("a:x/m2", "x/m2", "official", 0.5),
  ];

  it("每个模型一组；代表报价是最便宜的付费报价，免费和未知排最后", () => {
    const groups = groupByModel(sample);
    expect(groups.map((g) => [g.id, g.best.platform, g.platformCount])).toEqual([
      ["x/m1", "azure", 4],
      ["x/m2", "official", 1],
    ]);
    expect(groups[0]?.offerings.map((o) => o.platform)).toEqual([
      "azure",
      "official",
      "groq",
      "free",
    ]);
  });

  it("排序：默认按代表报价的混合价；平台列按平台数", () => {
    const groups = groupByModel(sample);
    expect(sortGroups(groups, DEFAULT_SORT).map((g) => g.id)).toEqual(["x/m2", "x/m1"]);
    expect(sortGroups(groups, { key: "platform", dir: "desc" }).map((g) => g.id)).toEqual([
      "x/m1",
      "x/m2",
    ]);
    expect(sortGroups(groups, { key: "platform", dir: "asc" }).map((g) => g.id)).toEqual([
      "x/m2",
      "x/m1",
    ]);
  });

  it("用夹具数据：组数 = 不同模型数，报价总数不变", () => {
    const groups = groupByModel(rows);
    expect(groups).toHaveLength(new Set(rows.map((r) => r.modelSlug)).size);
    expect(groups.reduce((n, g) => n + g.offerings.length, 0)).toBe(rows.length);
  });
});
