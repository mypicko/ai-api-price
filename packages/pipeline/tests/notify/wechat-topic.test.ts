import type { CnIntlData, CnIntlItem } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { MAX_DIGEST_LENGTH, MAX_TITLE_LENGTH } from "../../src/notify/wechat-article";
import { buildCnIntlArticle, fetchCnIntl } from "../../src/notify/wechat-topic";

const item = (slug: string, orPct: number | null, intlPct: number | null = null): CnIntlItem => ({
  modelSlug: slug,
  displayName: slug.split("/")[1] ?? slug,
  vendor: slug.split("/")[0] ?? "x",
  vendorName: "厂商",
  domestic: { input: 1, output: 4 },
  openrouter: orPct === null ? null : { input: 2, output: 8 },
  openrouterPct: orPct,
  intl: intlPct === null ? null : { input: 1, output: 4 },
  intlPct,
});

const DATA: CnIntlData = {
  summary: { total: 4, openrouter: { compared: 3, cheaper: 2 }, intl: { compared: 1, cheaper: 0 } },
  items: [
    item("zhipu/glm-5", -0.58),
    item("alibaba/qwen-plus", -0.3),
    item("tencent/hy4", 1.16),
    item("moonshot/kimi-k3", null, 0.01),
  ],
};

describe("公众号专题：国内 vs 海外价格（DEV §3.32）", () => {
  it("标题带统计、不超长；摘要不超长；阅读原文指向对比页", () => {
    const a = buildCnIntlArticle(DATA, "2026-11-22", "https://promptso.top", 7.1);
    expect(a?.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(a?.title).toContain("2/3");
    expect(a?.digest.length).toBeLessThanOrEqual(MAX_DIGEST_LENGTH);
    expect(a?.contentSourceUrl).toBe("https://promptso.top/cn-vs-intl/");
  });

  it("正文分「国内买更便宜」「国内反而更贵」「官方价国内外一致」三节，国内便宜的按幅度排序", () => {
    const html = buildCnIntlArticle(DATA, "2026-11-22", "https://promptso.top", 7.1)?.html ?? "";
    for (const text of [
      "国内买更便宜",
      "国内反而更贵",
      "官方价国内外基本一致",
      "glm-5",
      "hy4",
      "kimi-k3",
    ])
      expect(html).toContain(text);
    expect(html.indexOf("glm-5")).toBeLessThan(html.indexOf("qwen-plus"));
    expect(html).toContain("58%");
  });

  it("没有可比的数据时返回 null", () => {
    const empty = { ...DATA, items: [], summary: { ...DATA.summary, total: 0 } };
    expect(buildCnIntlArticle(empty, "2026-11-22", "https://x.top", 7.1)).toBeNull();
  });

  it("从网站读接口并校验结构；结构不对时报错", async () => {
    const good = vi.fn<(url: string) => Promise<Response>>(async () =>
      Response.json({ success: true, data: DATA, error: null, meta: { dataDate: "2026-11-22" } }),
    );
    await expect(fetchCnIntl("https://promptso.top", good)).resolves.toMatchObject({
      dataDate: "2026-11-22",
    });
    expect(good.mock.calls[0]?.[0]).toBe("https://promptso.top/api/v1/cn-vs-intl.json");
    const bad = vi.fn(async () => Response.json({ success: true, data: {} }));
    await expect(fetchCnIntl("https://promptso.top", bad)).rejects.toThrow(/cn-vs-intl/);
  });
});
