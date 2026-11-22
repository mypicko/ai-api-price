import type { ChangeEvent, Offering } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import {
  MAX_DIGEST_LENGTH,
  MAX_TITLE_LENGTH,
  type ArticleContext,
} from "../../src/notify/wechat-article";
import {
  buildWeeklyArticle,
  cheapestCn,
  mergeWeekChanges,
  weekRange,
} from "../../src/notify/wechat-weekly";

const ev = (
  date: string,
  type: ChangeEvent["type"],
  offeringId: string,
  fields: ChangeEvent["fields"] = [],
  extra: Partial<ChangeEvent> = {},
): ChangeEvent => {
  const [platform = "official", rest = ""] = offeringId.split(":");
  const [vendor = "x", model = "m"] = rest.split("/");
  return {
    id: `${date}-${offeringId}-1`,
    type,
    offeringId,
    vendor,
    modelSlug: `${vendor}/${model}`,
    displayName: model,
    platform,
    currency: "CNY",
    fields,
    confirmedFromQuarantine: false,
    detectedAt: `${date}T04:00:00Z`,
    ...extra,
  } as ChangeEvent;
};
const f = (field: "input" | "output", old: number, nw: number) => ({
  field,
  old,
  new: nw,
  pct: (nw - old) / old,
});

const offering = (
  id: string,
  input: number,
  output: number,
  extra: Partial<Offering> = {},
): Offering => {
  const [platform = "official-cn", rest = ""] = id.split(":");
  const [vendor = "x", model = "m"] = rest.split("/");
  return {
    id,
    vendor,
    model,
    modelSlug: `${vendor}/${model}`,
    displayName: model,
    platform,
    source: "s",
    currency: "CNY",
    input,
    output,
    tiers: null,
    contextWindow: null,
    maxOutput: null,
    modalities: ["text"],
    isFree: false,
    stale: false,
    status: "active",
    missingDays: 0,
    sourceUrl: "https://example.com",
    ...extra,
  } as unknown as Offering;
};

const ctx: ArticleContext = {
  usdCny: 7.2,
  vendorName: (id) =>
    (({ deepseek: "DeepSeek", qwen: "通义千问" }) as Record<string, string>)[id] ?? id,
  platformName: (id) =>
    (({ official: "官方", "official-cn": "官方（国内站）" }) as Record<string, string>)[id] ?? id,
  priceOf: () => ({ input: 1, output: 2, currency: "CNY" }),
};

describe("公众号周报（DEV §3.31）", () => {
  it("周一运行时统计上周一到上周日", () => {
    expect(weekRange("2026-11-23")).toEqual({ start: "2026-11-16", end: "2026-11-22" });
    expect(weekRange("2026-11-30")).toEqual({ start: "2026-11-23", end: "2026-11-29" });
  });

  it("同一报价一周内多次变价，合并成「周初价 → 周末价」；来回变动抵消的不算", () => {
    const merged = mergeWeekChanges([
      ev("2026-11-17", "price_down", "official:deepseek/v4", [f("input", 4, 2)]),
      ev("2026-11-19", "price_down", "official:deepseek/v4", [f("input", 2, 1)]),
      ev("2026-11-18", "price_up", "official:qwen/a", [f("output", 2, 4)]),
      ev("2026-11-20", "price_down", "official:qwen/a", [f("output", 4, 2)]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ type: "price_down", offeringId: "official:deepseek/v4" });
    expect(merged[0]?.fields).toEqual([{ field: "input", old: 4, new: 1, pct: -0.75 }]);
  });

  it("国内最便宜排行：只看国内站官方、在售、文本、非免费的人民币报价，按 3:1 混合价排序", () => {
    const list = cheapestCn(
      [
        offering("official-cn:qwen/cheap", 0.5, 1),
        offering("official-cn:deepseek/mid", 1, 2),
        offering("official-cn:qwen/free", 0, 0, { isFree: true }),
        offering("official-cn:qwen/gone", 0.1, 0.1, { status: "removed" } as Partial<Offering>),
        offering("official-cn:qwen/image", 0.1, 0.1, { modalities: ["image"] }),
        offering("official:qwen/intl", 0.1, 0.1),
        offering("siliconflow-cn:qwen/sf", 0.1, 0.1),
      ],
      10,
    );
    expect(list.map((o: Offering) => o.id)).toEqual([
      "official-cn:qwen/cheap",
      "official-cn:deepseek/mid",
    ]);
  });

  it("排行去掉 OCR / 翻译等专用模型，带日期快照与主版本同价时只留主版本", () => {
    const list = cheapestCn([
      offering("official-cn:qwen/qwen-flash", 0.15, 1.5, { displayName: "Qwen Flash" }),
      offering("official-cn:qwen/qwen-flash-2025-07-28", 0.15, 1.5, {
        displayName: "Qwen Flash (2025-07-28)",
      }),
      offering("official-cn:qwen/qwen-flash-latest", 0.15, 1.5, {
        displayName: "qwen-flash-latest",
      }),
      offering("official-cn:qwen/qwen-vl-ocr", 0.1, 0.1, { displayName: "Qwen-VL OCR" }),
      offering("official-cn:tencent/hy-mt2-lite", 0.1, 0.1, { displayName: "Hy-MT2-Lite" }),
    ]);
    expect(list.map((o: Offering) => o.displayName)).toEqual(["Qwen Flash"]);
  });

  it("生成文章：标题带日期范围、不超长；正文有新模型、降价、涨价和最便宜排行", () => {
    const article = buildWeeklyArticle(
      {
        start: "2026-11-16",
        end: "2026-11-22",
        events: [
          ev("2026-11-17", "new_model", "official:deepseek/v5"),
          ev("2026-11-18", "price_down", "official-cn:qwen/a", [f("input", 4, 2)]),
          ev("2026-11-19", "price_up", "official:qwen/b", [f("output", 2, 3)]),
        ],
        offerings: [offering("official-cn:qwen/cheap", 0.5, 1)],
        siteUrl: "https://promptso.top",
      },
      ctx,
    );
    expect(article).not.toBeNull();
    expect(article?.title.startsWith("AI 价格周报 11/16-11/22｜")).toBe(true);
    expect(article?.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(article?.digest.length).toBeLessThanOrEqual(MAX_DIGEST_LENGTH);
    for (const text of ["本周新模型", "本周降价", "本周涨价", "国内最便宜", "v5", "cheap"])
      expect(article?.html).toContain(text);
    expect(article?.contentSourceUrl).toBe("https://promptso.top/changes/wechat/");
  });

  it("一周没有任何变动也照常出周报（只有最便宜排行）；连排行都没有时返回 null", () => {
    const input = { start: "2026-11-16", end: "2026-11-22", events: [], siteUrl: "https://x.top" };
    const quiet = buildWeeklyArticle(
      { ...input, offerings: [offering("official-cn:qwen/a", 1, 2)] },
      ctx,
    );
    expect(quiet?.html).toContain("国内最便宜");
    expect(buildWeeklyArticle({ ...input, offerings: [] }, ctx)).toBeNull();
  });
});
