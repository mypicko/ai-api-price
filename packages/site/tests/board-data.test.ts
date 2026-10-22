import { describe, expect, it, vi } from "vitest";
import { boardCounts, boardData, boardTableRows, initialRows } from "../src/lib/board-data";
import { fetchBoardData } from "../src/lib/board-client";
import { unpackRows } from "../src/lib/pack";
import type { TableRow } from "../src/lib/table";
import { fixtureModel } from "./helpers";

const model = fixtureModel();

describe("首页价格榜数据拆分", () => {
  it("首屏只保留前 N 个模型，但保留这些模型的全部报价", () => {
    const rows = boardTableRows(model, "zh");
    const slugs = new Set(rows.map((r) => r.modelSlug));
    const first = initialRows(rows, 1);
    const kept = new Set(first.map((r) => r.modelSlug));
    expect(kept.size).toBe(1);
    const [slug] = [...kept];
    expect(first).toEqual(rows.filter((r) => r.modelSlug === slug));
    expect(new Set(initialRows(rows).map((r) => r.modelSlug)).size).toBe(Math.min(100, slugs.size));
  });

  it("全量数据与计数一致", () => {
    const data = boardData(model, "zh");
    const counts = boardCounts(data);
    expect(unpackRows<TableRow>(data.packedRows)).toEqual(boardTableRows(model, "zh"));
    expect(counts.text).toBe(model.offerings.length);
    expect(counts.video + counts.image).toBe(data.mediaRows.length);
    expect(counts.plans).toBe(data.planRows.length);
  });
});

describe("fetchBoardData", () => {
  const ok = (body: unknown) =>
    vi.fn(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    ) as unknown as typeof fetch;

  it("返回合法数据", async () => {
    const data = boardData(model, "zh");
    await expect(fetchBoardData("/data/board.json", ok(data))).resolves.toEqual(data);
  });

  it("HTTP 错误和格式错误都抛出", async () => {
    const notFound = vi.fn(
      async () => new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    await expect(fetchBoardData("/x", notFound)).rejects.toThrow("404");
    await expect(fetchBoardData("/x", ok({ packedRows: {} }))).rejects.toThrow("格式");
  });
});
