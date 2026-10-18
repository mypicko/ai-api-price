import { describe, expect, it } from "vitest";
import { findModel } from "../src/lib/site-model";
import {
  calcOfferings,
  chartOfferings,
  fxNote,
  platformOptions,
  toEventView,
  vendorOptions,
} from "../src/lib/views";
import { fixtureModel } from "./helpers";

const model = fixtureModel();

describe("views", () => {
  it("汇率提示", () => {
    expect(fxNote(model, "zh")).toMatch(/^按 1 USD = 7\.\d{2} CNY 换算（2026-10-17）$/);
  });

  it("厂商和平台选项", () => {
    const vendors = vendorOptions(model, "en");
    expect(vendors.map((v) => v.name)).toEqual(
      vendors.map((v) => v.name).toSorted((a, b) => a.localeCompare(b, "en")),
    );
    expect(vendors.some((v) => v.id === "cohere")).toBe(false);
    expect(vendorOptions(model, "zh", ["deepseek"])).toEqual([
      { id: "deepseek", name: "DeepSeek" },
    ]);
    expect(platformOptions(model, "zh").map((p) => p.name)).toEqual([
      "官方",
      "OpenRouter",
      "硅基流动",
    ]);
  });

  it("事件视图：新模型带当前价格", () => {
    const event = model.events.find(
      (e) => e.type === "new_model" && e.offeringId === "official:minimax/minimax-m2",
    );
    if (!event) throw new Error("缺少事件");
    const view = toEventView(model, event, "zh");
    expect(view.current).toEqual({ input: 2.1, output: 8.4 });
    expect(view.platformName).toBe("官方");
    const price = model.events.find((e) => e.type === "price_down");
    expect(price && toEventView(model, price, "en").current).toBeNull();
  });

  it("计算器跳过输出价缺失的报价", () => {
    const list = calcOfferings(model, "zh");
    expect(list.some((o) => o.id === "official:amazon/nova-micro")).toBe(false);
    expect(list.length).toBe(model.offerings.length - 1);
  });

  it("走势图按平台生成序列", () => {
    const info = findModel(model, "deepseek/deepseek-chat");
    if (!info) throw new Error("缺少模型");
    expect(chartOfferings(model, info, "en").map((c) => c.label)).toEqual([
      "Official",
      "OpenRouter",
      "SiliconFlow",
    ]);
  });
});
