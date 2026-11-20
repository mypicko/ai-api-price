import type { ChangeEvent } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  buildWechatArticle,
  MAX_DIGEST_LENGTH,
  MAX_ROWS_PER_SECTION,
  MAX_TITLE_LENGTH,
  type ArticleContext,
} from "../../src/notify/wechat-article";
import type { DailyReport } from "../../src/notify/types";
import { NOW_ISO } from "../helpers";

function event(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: "2026-10-31-official:deepseek/deepseek-chat-1",
    type: "price_down",
    offeringId: "official:deepseek/deepseek-chat",
    vendor: "deepseek",
    modelSlug: "deepseek/deepseek-chat",
    displayName: "DeepSeek V3",
    platform: "official",
    currency: "CNY",
    fields: [{ field: "output", old: 8, new: 4, pct: -0.5 }],
    confirmedFromQuarantine: false,
    detectedAt: NOW_ISO,
    ...overrides,
  };
}

function report(changes: readonly ChangeEvent[]): DailyReport {
  return {
    date: "2026-10-31",
    run: { id: "1", startedAt: NOW_ISO, finishedAt: NOW_ISO, durationMs: 1, result: "success" },
    sources: [],
    changes,
    quarantined: [],
    errors: [],
    siteUrl: "https://example.com/ai-api-price",
  };
}

const ctx: ArticleContext = {
  usdCny: 7,
  vendorName: (id) => ({ deepseek: "DeepSeek", moonshot: "月之暗面 Kimi" })[id] ?? id,
  platformName: (id) => ({ official: "官方", together: "Together AI" })[id] ?? id,
  priceOf: (offeringId) =>
    offeringId === "official:moonshot/kimi-k3.1-pro"
      ? { input: 2, output: 10, currency: "USD" }
      : null,
};

const newKimi = event({
  id: "2026-10-31-official:moonshot/kimi-k3.1-pro-1",
  type: "new_model",
  offeringId: "official:moonshot/kimi-k3.1-pro",
  vendor: "moonshot",
  modelSlug: "moonshot/kimi-k3.1-pro",
  displayName: "Kimi K3.1 Pro",
  currency: "USD",
  fields: [],
});

describe("buildWechatArticle：公众号日报文章", () => {
  it("没有值得发的变动（只有上下文变化、重新上架、第三方下架）时返回 null", () => {
    const noise = [
      event({ type: "context_change" }),
      event({ type: "restored" }),
      event({ type: "removed", platform: "together", offeringId: "together:x/y" }),
    ];
    expect(buildWechatArticle(report(noise), ctx)).toBeNull();
  });

  it("标题优先用官方新模型，不超过长度上限；摘要带变动统计", () => {
    const article = buildWechatArticle(report([event(), newKimi]), ctx);
    expect(article?.title).toBe("AI 价格日报 10/31｜Kimi K3.1 Pro 上线");
    expect(article?.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(article?.digest).toContain("降价 1");
    expect(article?.digest).toContain("新模型 1");
    expect(article?.digest.length).toBeLessThanOrEqual(MAX_DIGEST_LENGTH);
  });

  it("没有新模型时标题用降幅最大的官方降价", () => {
    const article = buildWechatArticle(report([event()]), ctx);
    expect(article?.title).toBe("AI 价格日报 10/31｜DeepSeek V3 降价 50%");
  });

  it("标题太长时先去掉涨跌幅，不在数字中间截断", () => {
    // 前缀 15 字 + 名字 13 字 + 「 降价 50%」7 字 = 35 > 32；去掉涨跌幅后 31 字放得下
    const long = event({ displayName: "GPT-5.6 Lunas" });
    const title = buildWechatArticle(report([long]), ctx)?.title ?? "";
    expect(title).toBe("AI 价格日报 10/31｜GPT-5.6 Lunas 降价");
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it("名字怎么都放不下时改用厂商名，不把名字截成半截", () => {
    const longNew = { ...newKimi, displayName: "north-mini-code-1.0", vendor: "deepseek" };
    expect(buildWechatArticle(report([longNew]), ctx)?.title).toBe(
      "AI 价格日报 10/31｜DeepSeek 新模型上线",
    );
    const longDrop = event({ displayName: "deepseek-reasoner-ultra-2026" });
    expect(buildWechatArticle(report([longDrop]), ctx)?.title).toBe(
      "AI 价格日报 10/31｜DeepSeek 降价 50%",
    );
  });

  it("厂商名也放不下时用通用说法", () => {
    const longVendor = {
      ...newKimi,
      displayName: "north-mini-code-1.0",
      vendor: "a-very-long-vendor-name-inc",
    };
    const title = buildWechatArticle(report([longVendor]), ctx)?.title ?? "";
    expect(title).toBe("AI 价格日报 10/31｜新模型上线");
    expect(title).not.toContain("…");
  });

  it("正文：新模型补上当天价格，价格变动写出新旧价和涨跌幅，阅读原文指向网站", () => {
    const article = buildWechatArticle(report([event(), newKimi]), ctx);
    expect(article?.html).toContain("Kimi K3.1 Pro");
    expect(article?.html).toContain("¥14.00");
    expect(article?.html).toContain("¥8.00");
    expect(article?.html).toContain("¥4.00");
    expect(article?.html).toContain("-50%");
    // 公众号专用落地页：内容同 /changes/，路径单独统计公众号带来的访问
    expect(article?.contentSourceUrl).toBe("https://example.com/ai-api-price/changes/wechat/");
    // 公众号正文不允许脚本，外链也点不了
    expect(article?.html).not.toMatch(/<script|<a\s/i);
  });

  it("官方排在第三方前面，同类按涨跌幅绝对值降序，超出上限的写「另有 N 条」", () => {
    const many = Array.from({ length: MAX_ROWS_PER_SECTION + 2 }, (_, i) =>
      event({
        id: `e${i}`,
        offeringId: `together:x/m${i}`,
        platform: "together",
        displayName: `第三方${i}号`,
        fields: [{ field: "input", old: 1, new: 1 - (i + 1) / 100, pct: -(i + 1) / 100 }],
      }),
    );
    const html = buildWechatArticle(
      report([...many, event({ displayName: "官方模型" })]),
      ctx,
    )?.html;
    if (!html) throw new Error("article");
    const biggest = `第三方${MAX_ROWS_PER_SECTION + 1}号`;
    expect(html.indexOf("官方模型")).toBeLessThan(html.indexOf(biggest));
    expect(html.indexOf(biggest)).toBeLessThan(html.indexOf(`第三方${MAX_ROWS_PER_SECTION}号`));
    // 1 条官方 + 10 条第三方，只显示前 MAX_ROWS_PER_SECTION 条，降幅最小的 3 条省略
    expect(html).not.toContain("第三方0号");
    expect(html).toContain("另有 3 条");
  });

  it("不收录 OpenRouter 聚合价（取最便宜服务商、天天波动），只有它时返回 null", () => {
    const or = event({
      displayName: "GLM 5.3",
      platform: "openrouter",
      offeringId: "openrouter:zhipu/glm-5.3",
    });
    expect(buildWechatArticle(report([or]), ctx)).toBeNull();
    expect(buildWechatArticle(report([or, event()]), ctx)?.html).not.toContain("GLM 5.3");
  });

  it("同一个新模型在多个平台上线只写一张卡，列出所有平台；价格相同只写一行", () => {
    const on = (platform: string) => ({
      ...newKimi,
      id: `${platform}-kimi`,
      platform,
      offeringId: `${platform}:moonshot/kimi-k3.1-pro`,
    });
    const article = buildWechatArticle(report([newKimi, on("together"), on("azure")]), {
      ...ctx,
      priceOf: () => ({ input: 2, output: 10, currency: "USD" }),
    });
    const html = article?.html ?? "";
    expect(html.match(/Kimi K3\.1 Pro/g)).toHaveLength(1);
    expect(html).toContain("官方、Together AI、azure");
    expect(html.match(/¥70\.00/g)).toHaveLength(1);
    // 摘要按模型数计：3 个平台上线的是同 1 个新模型
    expect(article?.digest).toContain("新模型 1");
  });

  it("同一个新模型各平台价格不同时，按价格分行并注明平台", () => {
    const together = {
      ...newKimi,
      id: "together-kimi",
      platform: "together",
      offeringId: "together:moonshot/kimi-k3.1-pro",
    };
    const html =
      buildWechatArticle(report([newKimi, together]), {
        ...ctx,
        priceOf: (id) =>
          id.startsWith("together")
            ? { input: 3, output: 12, currency: "USD" }
            : { input: 2, output: 10, currency: "USD" },
      })?.html ?? "";
    expect(html.indexOf("官方")).toBeLessThan(html.indexOf("¥70.00"));
    expect(html.indexOf("Together AI")).toBeLessThan(html.indexOf("¥84.00"));
  });

  it("开头有概览卡：各类变动的数量", () => {
    const html = buildWechatArticle(report([event(), newKimi]), ctx)?.html ?? "";
    const overview = html.slice(0, html.indexOf("Kimi K3.1 Pro"));
    expect(overview).toContain("10 月 31 日");
    expect(overview).toMatch(/>1<\/p><p[^>]*>新模型/);
    expect(overview).toMatch(/>1<\/p><p[^>]*>降价/);
  });

  it("价格一律按人民币显示：美元价按汇率换算，开头注明汇率", () => {
    const html = buildWechatArticle(report([event(), newKimi]), ctx)?.html ?? "";
    expect(html).not.toContain("$");
    expect(html).toContain("¥14.00");
    expect(html).toContain("¥70.00");
    expect(html).toContain("1 美元 ≈ 7.00 元");
  });

  it("美元价格变动的新旧价都换算成人民币", () => {
    const usd = event({
      currency: "USD",
      fields: [{ field: "input", old: 1, new: 0.5, pct: -0.5 }],
    });
    const html = buildWechatArticle(report([usd]), ctx)?.html ?? "";
    expect(html).toContain("¥7.00");
    expect(html).toContain("¥3.50");
    expect(html).toContain("-50%");
  });

  it("没有汇率时按原币种显示，不写汇率说明", () => {
    const html = buildWechatArticle(report([newKimi]), { ...ctx, usdCny: null })?.html ?? "";
    expect(html).toContain("$2.00");
    expect(html).not.toContain("美元 ≈");
  });

  it("模型名等文字会转义", () => {
    const html = buildWechatArticle(report([event({ displayName: "<b>X</b>" })]), ctx)?.html;
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
  });
});
