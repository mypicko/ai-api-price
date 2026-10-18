import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMediaData } from "../src/lib/load-data";
import {
  countByKind,
  DEFAULT_MEDIA_SORT,
  filterMediaRows,
  mediaAriaSort,
  nextMediaSort,
  parseMediaKind,
  sortMediaRows,
  type MediaRow,
} from "../src/lib/media";
import { buildSiteModel, toMediaTableRow } from "../src/lib/site-model";
import { mediaEventViews } from "../src/lib/views";
import { FIXTURE_DIR, fixtureData, fixtureModel, NOW } from "./helpers";

const model = fixtureModel();
const rows = model.media.offerings.map((o) => toMediaTableRow(model, o, "zh"));
const row = (id: string): MediaRow | undefined => rows.find((r) => r.id.endsWith(id));

describe("site/media 数据", () => {
  it("读取 data/media/，过滤已下架，换算两种币种", () => {
    expect(fixtureData().media.latest?.offerings).toHaveLength(11);
    expect(model.media.hasData).toBe(true);
    expect(model.media.offerings).toHaveLength(10);
    const h3 = row("minimax/minimax-h3");
    expect(h3).toMatchObject({ kind: "video", unit: "per_second", usd: [0.08, 0.04] });
    expect(h3?.cny[0]).toBeCloseTo(0.08 * model.usdCny, 5);
    expect(h3?.tiers.map((t) => t.label)).toEqual(["768p", "2k"]);
    expect(h3?.vendorName).toBe("MiniMax");
    const seedream = row("doubao-seedream-4.0");
    expect(seedream?.cny[0]).toBe(0.2);
    expect(seedream?.usd[0]).toBeCloseTo(0.2 / model.usdCny, 5);
  });

  it("7 日变化：只看生成价；7 天前没有记录时为 null", () => {
    expect(row("minimax/minimax-h3")?.change7d).toBe(-0.2);
    expect(row("flux-pro-1.1")?.change7d).toBe(0);
    const empty = buildSiteModel(
      { ...fixtureData(), media: { ...fixtureData().media, histories: new Map() } },
      NOW,
    );
    expect(empty.media.offerings.every((o) => o.change7d === null)).toBe(true);
  });

  it("视频/图像事件与文本事件分开，单位按 offering 记录", () => {
    expect(model.media.events.length).toBeGreaterThan(0);
    expect(model.events.some((e) => e.offeringId.includes("minimax-h3"))).toBe(false);
    expect(model.media.units.get("official:openai/sora-2")).toBe("per_second");
    const views = mediaEventViews(model, model.media.events, "zh");
    const h3 = views.find((v) => v.id.includes("minimax-h3") && v.type === "price_down");
    expect(h3?.fields).toEqual(["生成价 $0.100/秒 → $0.0800/秒（-20%）"]);
    const en = mediaEventViews(model, model.media.events, "en", 1);
    expect(en).toHaveLength(1);
  });

  it("输入图字段总是按张显示；未知 offering 默认按秒", () => {
    const first = model.media.events[0];
    if (!first) throw new Error("fixture 缺少视频/图像事件");
    const event = {
      ...first,
      offeringId: "official:x/unknown",
      fields: [{ field: "input" as const, old: 0.01, new: 0.02, pct: 1 }],
    };
    expect(mediaEventViews(model, [event], "en")[0]?.fields).toEqual([
      "Input image $0.0100/image → $0.0200/image（+100%）",
    ]);
  });

  it("没有 data/media/ 时返回空数据；文件不合法时报错", () => {
    const dir = mkdtempSync(join(tmpdir(), "aipb-media-"));
    expect(loadMediaData(dir)).toMatchObject({ latest: null, changeMonths: [] });
    mkdirSync(join(dir, "media"));
    writeFileSync(join(dir, "media", "latest.json"), JSON.stringify({ schemaVersion: "1.1.0" }));
    expect(() => loadMediaData(dir)).toThrow(/media/);
    expect(loadMediaData(FIXTURE_DIR).histories.size).toBe(11);
  });
});

describe("site/media 表格", () => {
  it("按类型和关键字筛选（匹配名称、模型 ID、厂商名、平台名）", () => {
    expect(filterMediaRows(rows, { kind: "video", query: "" })).toHaveLength(5);
    expect(filterMediaRows(rows, { kind: "image", query: "" })).toHaveLength(5);
    expect(filterMediaRows(rows, { kind: "video", query: "minimax" }).map((r) => r.model)).toEqual([
      "minimax-h3",
      "minimax-h3-max",
    ]);
    expect(filterMediaRows(rows, { kind: "image", query: "Stability" })).toHaveLength(1);
    expect(countByKind(rows)).toEqual({ video: 5, image: 5 });
  });

  it("默认按价格升序；空值排最后；可以按名称、厂商、更新时间排序", () => {
    const video = filterMediaRows(rows, { kind: "video", query: "" });
    const byPrice = sortMediaRows(video, DEFAULT_MEDIA_SORT).map((r) => r.usd[0]);
    expect(byPrice).toEqual(byPrice.toSorted((a, b) => (a ?? 0) - (b ?? 0)));
    const byInput = sortMediaRows(video, { key: "input", dir: "desc" });
    expect(byInput.at(-1)?.usd[1]).toBeNull();
    expect(byInput[0]?.model).toBe("minimax-h3-max");
    const names = sortMediaRows(video, { key: "model", dir: "asc" }).map((r) =>
      r.displayName.toLowerCase(),
    );
    expect(names).toEqual(names.toSorted());
    expect(sortMediaRows(video, { key: "vendor", dir: "desc" })[0]?.vendorName).toBeDefined();
    expect(sortMediaRows(video, { key: "updated", dir: "asc" })[0]?.stale).toBe(true);
  });

  it("平台列：可以按平台名搜索和排序", () => {
    expect(row("minimax/minimax-h3")?.platformName).toBe("官方");
    const video = filterMediaRows(rows, { kind: "video", query: "" });
    const viaOpenRouter = video.map((r, i) => (i === 0 ? { ...r, platformName: "OpenRouter" } : r));
    expect(filterMediaRows(viaOpenRouter, { kind: "video", query: "openrouter" })).toHaveLength(1);
    const sorted = sortMediaRows(viaOpenRouter, { key: "platform", dir: "asc" });
    expect(sorted[0]?.platformName).toBe("OpenRouter");
    expect(nextMediaSort(DEFAULT_MEDIA_SORT, "platform")).toEqual({ key: "platform", dir: "asc" });
  });

  it("排序切换与 aria-sort", () => {
    expect(nextMediaSort(DEFAULT_MEDIA_SORT, "price")).toEqual({ key: "price", dir: "desc" });
    expect(nextMediaSort(DEFAULT_MEDIA_SORT, "updated")).toEqual({ key: "updated", dir: "desc" });
    expect(nextMediaSort(DEFAULT_MEDIA_SORT, "model")).toEqual({ key: "model", dir: "asc" });
    expect(mediaAriaSort(DEFAULT_MEDIA_SORT, "price")).toBe("ascending");
    expect(mediaAriaSort({ key: "price", dir: "desc" }, "price")).toBe("descending");
    expect(mediaAriaSort(DEFAULT_MEDIA_SORT, "model")).toBe("none");
  });

  it("?kind= 参数", () => {
    expect(parseMediaKind("?kind=image")).toBe("image");
    expect(parseMediaKind("?kind=audio")).toBe("video");
    expect(parseMediaKind("")).toBe("video");
  });
});
