import type { ChangeEvent } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  RSS_LIMIT,
  buildRss,
  compactPrice,
  rssDescription,
  rssTitle,
  selectRssEvents,
  type RssContext,
} from "../src/lib/rss";
import { buildSitemap } from "../src/lib/sitemap";
import { el, escapeXml, serializeXml, textEl, xmlDocument } from "../src/lib/xml";
import { fixtureModel } from "./helpers";

const event: ChangeEvent = {
  id: "2026-11-02-official:deepseek/deepseek-chat-1",
  type: "price_down",
  offeringId: "official:deepseek/deepseek-chat",
  vendor: "deepseek",
  modelSlug: "deepseek/deepseek-chat",
  displayName: "DeepSeek-V3",
  platform: "official",
  currency: "CNY",
  fields: [{ field: "output", old: 16, new: 8, pct: -0.5 }],
  confirmedFromQuarantine: false,
  detectedAt: "2026-11-02T00:02:10Z",
};

const ctx = (locale: "zh" | "en"): RssContext => ({
  locale,
  site: "https://alice.github.io",
  base: "/ai-api-price/",
  generatedAt: "2026-11-02T00:04:12Z",
  platformName: (id) => (id === "official" ? (locale === "zh" ? "官方" : "Official") : id),
  currentPrices: () => ({ input: 2, output: 8 }),
});

describe("xml", () => {
  it("转义特殊字符并去掉非法控制字符", () => {
    expect(escapeXml(`<a href="x">&'\u0001</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("序列化节点树", () => {
    const doc = xmlDocument(
      el("root", { a: "1&2" }, [textEl("x", "<y>"), el("empty"), el("nested", {}, ["t", el("z")])]),
    );
    expect(doc).toContain('<root a="1&amp;2">');
    expect(doc).toContain("<x>&lt;y&gt;</x>");
    expect(doc).toContain("<empty/>");
    expect(serializeXml("a<b")).toBe("a&lt;b");
  });

  it("拒绝非法的元素名和属性名", () => {
    expect(() => el("bad name")).toThrow();
    expect(() => serializeXml(el("ok", { "bad attr": "x" }))).toThrow();
  });
});

describe("rss", () => {
  it("标题模板（中文 / 英文）", () => {
    expect(rssTitle(event, ctx("zh"))).toBe("🔻 DeepSeek-V3（官方）输出价 ¥16 → ¥8（-50%）");
    expect(rssTitle(event, ctx("en"))).toBe("🔻 DeepSeek-V3 (Official) Output ¥16 → ¥8 (-50%)");
    expect(rssTitle({ ...event, type: "price_up" }, ctx("zh"))).toMatch(/^🔺/);
    expect(rssTitle({ ...event, type: "new_model", fields: [] }, ctx("zh"))).toBe(
      "🆕 新模型：DeepSeek-V3（官方）输入 ¥2 / 输出 ¥8",
    );
    expect(rssTitle({ ...event, type: "removed", fields: [] }, ctx("en"))).toBe(
      "⛔ Removed: DeepSeek-V3 (Official)",
    );
    expect(rssTitle({ ...event, type: "restored", fields: [] }, ctx("zh"))).toBe(
      "♻️ 重新上架：DeepSeek-V3（官方）",
    );
  });

  it("新模型找不到当前价格时显示 —", () => {
    const missing = { ...ctx("zh"), currentPrices: () => null };
    expect(rssTitle({ ...event, type: "new_model", fields: [] }, missing)).toContain(
      "输入 — / 输出 —",
    );
  });

  it("描述写完整价格", () => {
    expect(rssDescription(event, ctx("zh"))).toBe("每百万 token：输出 ¥16.00 → ¥8.00");
    expect(rssDescription({ ...event, type: "removed", fields: [] }, ctx("zh"))).toBe(
      "已下架：DeepSeek-V3（官方）",
    );
    const ctxEvent = {
      ...event,
      type: "context_change" as const,
      fields: [{ field: "contextWindow" as const, old: 131072, new: 262144, pct: 1 }],
    };
    expect(rssDescription(ctxEvent, ctx("en"))).toBe("Per 1M tokens: context 128K → 256K");
  });

  it("紧凑价格去掉多余的 0", () => {
    expect(compactPrice("¥16.00")).toBe("¥16");
    expect(compactPrice("$0.150")).toBe("$0.15");
    expect(compactPrice("$0.00375")).toBe("$0.00375");
    expect(compactPrice("$1,200")).toBe("$1,200");
    expect(compactPrice("$15.50")).toBe("$15.5");
  });

  it("最多 100 条，不含 context_change，按时间倒序", () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...event,
      id: `e${i}`,
      detectedAt: new Date(Date.parse("2026-01-01T00:00:00Z") + i * 3_600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
    }));
    const selected = selectRssEvents([
      ...many,
      { ...event, id: "ctx", type: "context_change", detectedAt: "2027-01-01T00:00:00Z" },
    ]);
    expect(selected).toHaveLength(RSS_LIMIT);
    expect(selected[0]?.id).toBe("e119");
    expect(selected.some((e) => e.type === "context_change")).toBe(false);
  });

  it("生成合法的 RSS 2.0，并转义抓来的文本", () => {
    const xml = buildRss(
      [{ ...event, displayName: `<script>alert("x")</script> & co` }],
      ctx("zh"),
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain("<language>zh-cn</language>");
    expect(xml).toContain(
      "<link>https://alice.github.io/ai-api-price/models/deepseek/deepseek-chat/</link>",
    );
    expect(xml).toContain(
      '<guid isPermaLink="false">2026-11-02-official:deepseek/deepseek-chat-1</guid>',
    );
    expect(xml).toContain("<pubDate>Mon, 02 Nov 2026 00:02:10 GMT</pubDate>");
    expect(xml).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
    expect(xml).not.toContain("<script>");
    expect(buildRss([event], ctx("en"))).toContain(
      "<link>https://alice.github.io/ai-api-price/en/models/deepseek/deepseek-chat/</link>",
    );
  });

  it("fixture 数据生成的 RSS 包含新模型标题", () => {
    const model = fixtureModel();
    const xml = buildRss(model.events, {
      ...ctx("zh"),
      currentPrices: (id) => model.offeringsById.get(id) ?? null,
    });
    expect(xml).toContain("🆕 新模型：MiniMax-M2（官方）输入 ¥2.1 / 输出 ¥8.4");
    expect(xml).not.toContain("<category>context_change</category>");
  });
});

describe("sitemap", () => {
  it("每个页面列出中英文版本和 hreflang", () => {
    const xml = buildSitemap(
      "https://a.github.io",
      "/x/",
      ["", "calculator/"],
      "2026-10-18T00:04:12Z",
    );
    expect(xml).toContain("<loc>https://a.github.io/x/</loc>");
    expect(xml).toContain("<loc>https://a.github.io/x/en/calculator/</loc>");
    expect(xml).toContain('hreflang="zh-CN" href="https://a.github.io/x/calculator/"');
    expect(xml).toContain('hreflang="x-default"');
    expect(xml).toContain("<lastmod>2026-10-18</lastmod>");
  });
});

describe("单个模型的 RSS", () => {
  it("只包含该模型的变动，频道标题和链接指向模型页", async () => {
    const { modelRssXml, modelRssPath } = await import("../src/lib/endpoints");
    const { fixtureModel } = await import("./helpers");
    const model = fixtureModel();
    const info = model.models.find((m) => m.slug === "alibaba/qwen3-max");
    if (!info) throw new Error("fixture");
    const xml = modelRssXml(model, info, "zh", "https://a.io", "/x/");
    expect(xml).toContain(`<title>${info.displayName} 价格变动 · AI API 价格榜</title>`);
    expect(xml).toContain("<link>https://a.io/x/models/alibaba/qwen3-max/</link>");
    const items = xml.match(/<item>/g) ?? [];
    expect(items.length).toBe(3);
    expect(xml).not.toContain("kimi-k2");
    expect(modelRssPath("alibaba/qwen3-max")).toBe("models/alibaba/qwen3-max/rss.xml");
    // 没有变动的模型也是合法的空订阅源
    const quiet = model.models.find((m) => m.slug === "amazon/nova-micro");
    if (!quiet) throw new Error("fixture");
    expect(modelRssXml(model, quiet, "en", "https://a.io", "/").match(/<item>/g)).toBeNull();
  });
});
