import { describe, expect, it } from "vitest";
import { allGaps, gapFor } from "../src/lib/gap";
import { buildSiteModel } from "../src/lib/site-model";
import { fixtureData, fixtureModel, NOW } from "./helpers";

const model = fixtureModel();

describe("gap：国内外价差", () => {
  it("夹具里同时有国内人民币官方价和 OpenRouter 价的模型都会算出价差", () => {
    const slugs = allGaps(model)
      .map((g) => g.modelSlug)
      .toSorted();
    expect(slugs).toEqual(["alibaba/qwen3-max", "deepseek/deepseek-chat", "moonshot/kimi-k2"]);
  });

  it("价差 = (国内 − OpenRouter) / OpenRouter，按混合价（美元）比较", () => {
    const gap = gapFor(model, "deepseek/deepseek-chat");
    if (!gap) throw new Error("fixture");
    const a = gap.domestic.blended?.usd ?? 0;
    const b = gap.openrouter.blended?.usd ?? 0;
    expect(gap.pct).toBeCloseTo((a - b) / b, 10);
    expect(gap.domestic.currency).toBe("CNY");
    expect(gap.openrouter.platform).toBe("openrouter");
  });

  it("国内站优先；国际厂商（美元官方价）不算国内价；缺一边时为 null", () => {
    const official = model.offeringsById.get("official:deepseek/deepseek-chat");
    if (!official) throw new Error("fixture");
    const cn = { ...official, id: "official-cn:deepseek/deepseek-chat", platform: "official-cn" };
    const offeringsById = new Map(model.offeringsById);
    offeringsById.set(cn.id, cn);
    expect(gapFor({ ...model, offeringsById }, "deepseek/deepseek-chat")?.domestic.platform).toBe(
      "official-cn",
    );
    expect(gapFor(model, "openai/gpt-5")).toBeNull();
    expect(gapFor(model, "nope/nope")).toBeNull();
  });

  it("OpenRouter 价比同模型其它平台中位数低 3 倍以上时视为异常，不算价差", () => {
    const data = fixtureData();
    const latest = data.latest;
    if (!latest) throw new Error("fixture");
    const or = latest.offerings.find((o) => o.id === "openrouter:deepseek/deepseek-chat");
    if (!or) throw new Error("fixture");
    // 对照报价：官方、硅基流动、再加一个平台
    const peer = { ...or, id: "together:deepseek/deepseek-chat", platform: "together" };
    const cheap = { ...or, input: 0.01 };
    const offerings = latest.offerings.filter((o) => o.id !== or.id).concat([peer, cheap]);
    const outlierModel = buildSiteModel({ ...data, latest: { ...latest, offerings } }, NOW);
    expect(gapFor(outlierModel, "deepseek/deepseek-chat")).toBeNull();
    expect(allGaps(outlierModel).map((g) => g.modelSlug)).not.toContain("deepseek/deepseek-chat");
  });

  it("按价差绝对值降序", () => {
    const pcts = allGaps(model).map((g) => Math.abs(g.pct));
    expect(pcts).toEqual(pcts.toSorted((a, b) => b - a));
  });
});
