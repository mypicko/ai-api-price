import { describe, expect, it } from "vitest";
import {
  buildSiteModel,
  eventsWithinDays,
  findModel,
  groupEventsByDate,
  historyFor,
  platformName,
  recentEvents,
  staleDays,
  toTableRow,
  vendorName,
  vendorRegion,
} from "../src/lib/site-model";
import { NOW, fixtureData, fixtureModel } from "./helpers";

describe("site-model", () => {
  const model = fixtureModel();

  it("公开报价过滤掉已下架的条目", () => {
    expect(model.allOfferings.some((o) => o.status === "removed")).toBe(true);
    expect(model.offerings.some((o) => o.status === "removed")).toBe(false);
    expect(model.offerings.length).toBe(model.allOfferings.length - 1);
    expect(model.hasData).toBe(true);
    expect(model.generatedAt).toBe("2026-10-18T00:04:12Z");
  });

  it("按模型分组，官方报价排在前面", () => {
    const deepseek = findModel(model, "deepseek/deepseek-chat");
    expect(deepseek?.offerings.map((o) => o.platform)).toEqual([
      "official",
      "openrouter",
      "siliconflow",
    ]);
    expect(deepseek?.status).toBe("active");
    expect(deepseek?.firstSeenAt).toBe("2026-07-01");
    expect(findModel(model, "cohere/command-r-plus")?.status).toBe("removed");
    expect(findModel(model, "mistral/mistral-large")?.status).toBe("missing");
    expect(Object.keys(historyFor(model, "deepseek/deepseek-chat"))).toHaveLength(3);
    expect(historyFor(model, "nope/nope")).toEqual({});
  });

  it("厂商和平台名称按语言显示，未知 ID 原样返回", () => {
    expect(vendorName(model, "alibaba", "zh")).toBe("阿里通义");
    expect(vendorName(model, "alibaba", "en")).toBe("Alibaba Qwen");
    expect(vendorName(model, "unknown", "en")).toBe("unknown");
    expect(vendorRegion(model, "deepseek")).toBe("cn");
    expect(vendorRegion(model, "unknown")).toBe("intl");
    expect(platformName(model, "siliconflow", "zh")).toBe("硅基流动");
    expect(platformName(model, "official", "en")).toBe("Official");
    expect(platformName(model, "unknown", "zh")).toBe("unknown");
  });

  it("事件按时间倒序；今日变动最多 6 条且不含 context_change", () => {
    const times = model.events.map((e) => e.detectedAt);
    expect(times).toEqual(times.toSorted().toReversed());
    const recent = recentEvents(model.events, NOW);
    expect(recent.items.length).toBe(6);
    expect(recent.total).toBeGreaterThan(6);
    expect(recent.items.every((e) => e.type !== "context_change")).toBe(true);
    expect(eventsWithinDays(model.events, NOW, 3).every((e) => e.detectedAt >= "2026-10-15")).toBe(
      true,
    );
  });

  it("按北京时间日期分组", () => {
    const groups = groupEventsByDate(model.events);
    expect(groups[0]?.date).toBe("2026-10-18");
    expect(new Set(groups.map((g) => g.date)).size).toBe(groups.length);
  });

  it("过期天数", () => {
    expect(staleDays({ fetchedAt: "2026-10-10T00:02:05Z" }, NOW)).toBe(8);
    expect(staleDays({ fetchedAt: "2026-10-19T00:00:00Z" }, NOW)).toBe(0);
  });

  it("生成表格行", () => {
    const offering = model.offeringsById.get("official:alibaba/qwen3-max");
    if (!offering) throw new Error("缺少 qwen3-max");
    const row = toTableRow(model, offering, "zh");
    expect(row.vendorName).toBe("阿里通义");
    expect(row.region).toBe("cn");
    expect(row.cny[0]).toBe(6);
    expect(row.hasTiers).toBe(true);
    expect(row.change7d).toBe(-0.4);
  });

  it("没有数据时也能生成空模型", () => {
    const empty = buildSiteModel(
      { ...fixtureData(), latest: null, histories: new Map(), changeMonths: [], status: null },
      "2026-10-18T03:00:00Z",
    );
    expect(empty.hasData).toBe(false);
    expect(empty.offerings).toEqual([]);
    expect(empty.models).toEqual([]);
    expect(empty.dataDate).toBe("2026-10-18");
    expect(empty.generatedAt).toBe("2026-10-18T03:00:00Z");
  });
});
