import { describe, expect, it } from "vitest";
import { robotsResponse } from "../src/lib/endpoints";
import { goHref, goKey, goTargets } from "../src/lib/go";
import { fixtureModel } from "./helpers";

const model = fixtureModel();

describe("站外跳转页 /go/<key>/（点击统计）", () => {
  it("官方报价按厂商分，第三方平台按平台分", () => {
    expect(goKey({ platform: "official", vendor: "deepseek" })).toBe("v-deepseek");
    expect(goKey({ platform: "official-cn", vendor: "deepseek" })).toBe("v-deepseek");
    expect(goKey({ platform: "openrouter", vendor: "deepseek" })).toBe("p-openrouter");
  });

  it("厂商跳到定价页（没有就跳官网），平台同理；没有地址的不生成", () => {
    const targets = goTargets(model);
    const keys = targets.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [id, vendor] of model.vendors) {
      const target = targets.find((t) => t.key === `v-${id}`);
      expect(target?.url).toBe(vendor.pricingUrl ?? vendor.website);
    }
    for (const [id, platform] of model.platforms) {
      const target = targets.find((t) => t.key === `p-${id}`);
      if (platform.category === "official" || id.startsWith("official"))
        expect(target).toBeUndefined();
      else expect(target?.url ?? null).toBe(platform.pricingUrl ?? platform.website ?? null);
    }
    for (const t of targets) expect(t.url).toMatch(/^https?:\/\//);
  });

  it("goHref：有跳转目标时返回带 base 的站内路径，否则 null", () => {
    const vendor = [...model.vendors.keys()][0] ?? "";
    expect(goHref(model, "/x/", { platform: "official", vendor })).toBe(`/x/go/v-${vendor}/`);
    expect(goHref(model, "/x/", { platform: "no-such-platform", vendor })).toBeNull();
  });

  it("robots.txt 不让搜索引擎抓取跳转页", async () => {
    expect(await robotsResponse(new URL("https://a.github.io")).text()).toContain("Disallow: /go/");
  });
});
