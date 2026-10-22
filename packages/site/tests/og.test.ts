import { describe, expect, it } from "vitest";
import { boardTableRows } from "../src/lib/board-data";
import { OG_HEIGHT, OG_WIDTH, modelCardNode, ogModelCard, renderPng } from "../src/lib/og";
import { siteVerificationMeta } from "../src/lib/seo";
import { modelOgPath } from "../src/lib/url";
import { fixtureModel } from "./helpers";

const model = fixtureModel();

describe("分享卡片文字", () => {
  it("中文卡片用人民币，英文卡片用美元，写明最低价平台和平台数", () => {
    const slug = model.models[0]?.slug ?? "";
    const zh = ogModelCard(boardTableRows(model, "zh"), slug, "zh");
    const en = ogModelCard(boardTableRows(model, "en"), slug, "en");
    expect(zh?.price).toMatch(/¥/);
    expect(zh?.detail).toMatch(/^最低价来自 .+ · 共 \d+ 个平台/);
    expect(en?.price).toMatch(/\$/);
    expect(en?.detail).toMatch(/^Cheapest on /);
  });

  it("没有报价的模型返回 null", () => {
    expect(ogModelCard(boardTableRows(model, "zh"), "nobody/none", "zh")).toBeNull();
  });

  it("分享图路径", () => {
    expect(modelOgPath("openai/gpt-5")).toBe("og/models/openai/gpt-5.png");
  });
});

describe("renderPng", () => {
  it("输出 1200×630 的 PNG，中文不报错", async () => {
    const png = await renderPng(
      modelCardNode(
        {
          displayName: "通义千问 Max",
          vendorName: "阿里",
          price: "¥2.40 / ¥9.60",
          detail: "共 3 个平台",
        },
        "zh",
        "example.com",
      ),
    );
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([...png.slice(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(view.getUint32(16)).toBe(OG_WIDTH);
    expect(view.getUint32(20)).toBe(OG_HEIGHT);
  });
});

describe("搜索引擎站点验证", () => {
  it("只输出配置了且格式合法的值", () => {
    expect(siteVerificationMeta({})).toEqual([]);
    expect(
      siteVerificationMeta({
        GOOGLE_SITE_VERIFICATION: " abc-DEF_123 ",
        BAIDU_SITE_VERIFICATION: 'codeva-x"><script>',
      }),
    ).toEqual([{ name: "google-site-verification", content: "abc-DEF_123" }]);
  });
});
