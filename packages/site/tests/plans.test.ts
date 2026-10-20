import { describe, expect, it } from "vitest";
import { loadPlans } from "../src/lib/load-data";
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PLAN_FILTERS,
  breakEven,
  filterPlans,
  parsePlanFilters,
  serializePlanFilters,
  sortPlans,
  creditsMultiple,
  parseAssumptions,
  perRequestUsd,
  serializeAssumptions,
  toPlanRows,
} from "../src/lib/plans";
import { fixtureModel } from "./helpers";
import { join } from "node:path";

const model = fixtureModel();
const files = loadPlans(join(__dirname, "fixtures", "plans"));
const rows = toPlanRows(model, files, "zh");
const find = (id: string) => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`缺少套餐 ${id}`);
  return row;
};

describe("plans：配置与表格行", () => {
  it("读取 fixtures/plans，按月费（美元）升序", () => {
    expect(rows.map((r) => r.id)).toEqual([
      "glm-lite",
      "copilot-pro",
      "glm-unknown",
      "copilot-max",
    ]);
  });

  it("月费同时给出美元和人民币；人民币套餐按汇率换算", () => {
    const lite = rows.find((r) => r.id === "glm-lite");
    expect(lite?.currency).toBe("CNY");
    expect(lite?.monthly.cny).toBe(49);
    expect(lite?.monthly.usd).toBeCloseTo(49 / model.usdCny, 4);
    expect(lite?.annualMonthly?.cny).toBe(40);
  });

  it("计价模型取官方价（美元），没有这个模型时为 null", () => {
    const pro = rows.find((r) => r.id === "copilot-pro");
    expect(pro?.model?.slug).toBe("anthropic/claude-sonnet-4.5");
    expect(pro?.model?.input).toBeGreaterThan(0);
    const missing = toPlanRows(
      model,
      files.map((f) => ({ ...f, breakEvenModel: "nope/nope" })),
      "zh",
    );
    expect(missing.every((r) => r.model === null)).toBe(true);
  });
});

describe("plans：计价模型的平台", () => {
  it("国内套餐优先用国内站价格，国际套餐优先用官方（国际）价格", () => {
    const official = model.offeringsById.get("official:zhipu/glm-4.6");
    if (!official) throw new Error("fixture");
    const cn = {
      ...official,
      id: "official-cn:zhipu/glm-4.6",
      platform: "official-cn",
      displayName: "GLM-4.6 国内站",
    };
    const offeringsById = new Map(model.offeringsById);
    offeringsById.set(cn.id, cn);
    const patched = { ...model, offeringsById };
    const glm = files.filter((f) => f.provider.id === "zhipu");
    expect(toPlanRows(patched, glm, "zh")[0]?.model?.displayName).toBe("GLM-4.6 国内站");
    const intl = glm.map((f) => ({ ...f, provider: { ...f.provider, region: "intl" as const } }));
    expect(toPlanRows(patched, intl, "zh")[0]?.model?.displayName).toBe(official.displayName);
  });
});

describe("plans：回本计算", () => {
  const priced = { slug: "x/y", displayName: "Y", input: 3, output: 15, cacheRead: 0.3 };

  it("单次请求按量费用：缓存命中部分用缓存价，没有缓存价时按输入价", () => {
    const a = { inputTokens: 10_000, outputTokens: 1_000, cacheHitRate: 0.5 };
    // 5000×3 + 5000×0.3 + 1000×15 = 31,500 → /1e6
    expect(perRequestUsd(priced, a)).toBeCloseTo(0.0315, 6);
    expect(perRequestUsd({ ...priced, cacheRead: null }, a)).toBeCloseTo(0.045, 6);
  });

  it("回本次数 = 月费 ÷ 单次按量费用（向上取整），并给出每天次数", () => {
    const row = rows.find((r) => r.id === "copilot-pro");
    if (!row) throw new Error("fixture");
    const result = breakEven(
      { ...row, model: priced },
      { ...DEFAULT_ASSUMPTIONS, cacheHitRate: 0 },
    );
    const perReq = (30_000 * 3 + 1_500 * 15) / 1e6;
    expect(result?.perMonth).toBe(Math.ceil(10 / perReq));
    expect(result?.perDay).toBe(Math.ceil(10 / perReq / 30));
    expect(breakEven({ ...row, model: null }, DEFAULT_ASSUMPTIONS)).toBeNull();
  });

  it("额度价值倍数 = 含额度 ÷ 月费；没有额度时为 null", () => {
    expect(creditsMultiple(find("copilot-pro"))).toBe(1.5);
    expect(creditsMultiple(find("copilot-max"))).toBe(2);
    expect(creditsMultiple(find("glm-lite"))).toBeNull();
  });
});

describe("plans：用量假设与 URL 同步", () => {
  it("默认值不写进 URL；非法值回到默认", () => {
    expect(serializeAssumptions(DEFAULT_ASSUMPTIONS)).toBe("");
    const custom = { inputTokens: 8000, outputTokens: 500, cacheHitRate: 0.5 };
    const query = serializeAssumptions(custom);
    expect(query).toBe("in=8000&out=500&cache=50");
    expect(parseAssumptions(`?${query}`)).toEqual(custom);
    expect(parseAssumptions("?in=-1&out=abc&cache=150")).toEqual(DEFAULT_ASSUMPTIONS);
  });
});

describe("plans.json 接口", () => {
  it("输出全部套餐文件，count 为套餐总数", async () => {
    const { plansPayload } = await import("../src/lib/api");
    const body = plansPayload({ ...model, data: { ...model.data, plans: files } });
    expect(body.success).toBe(true);
    expect(body.data.providers.map((p) => p.provider.id)).toEqual(["github-copilot", "zhipu"]);
    expect(body.meta.count).toBe(4);
  });
});

describe("plans：筛选与排序", () => {
  it("关键字匹配提供方、套餐名和工具；地区；只看公开额度", () => {
    expect(filterPlans(rows, { ...DEFAULT_PLAN_FILTERS, q: "copilot" }).map((r) => r.id)).toEqual([
      "copilot-pro",
      "copilot-max",
    ]);
    expect(filterPlans(rows, { ...DEFAULT_PLAN_FILTERS, q: "智谱 lite" }).map((r) => r.id)).toEqual(
      ["glm-lite"],
    );
    expect(
      filterPlans(rows, { ...DEFAULT_PLAN_FILTERS, region: "cn" }).every((r) => r.region === "cn"),
    ).toBe(true);
    expect(
      filterPlans(rows, { ...DEFAULT_PLAN_FILTERS, region: "intl" }).map((r) => r.providerId),
    ).toEqual(["github-copilot", "github-copilot"]);
    expect(
      filterPlans(rows, { ...DEFAULT_PLAN_FILTERS, publishedOnly: true }).map((r) => r.id),
    ).toEqual(["glm-lite", "copilot-pro", "copilot-max"]);
  });

  it("排序：月费、回本次数（算不出的排最后）、额度价值（没有的排最后）", () => {
    const byPrice = sortPlans(rows, "price", DEFAULT_ASSUMPTIONS).map((r) => r.id);
    expect(byPrice).toEqual(["glm-lite", "copilot-pro", "glm-unknown", "copilot-max"]);
    const byBreakEven = sortPlans(rows, "breakEven", DEFAULT_ASSUMPTIONS);
    const counts = byBreakEven.map((r) => breakEven(r, DEFAULT_ASSUMPTIONS)?.perMonth ?? Infinity);
    expect(counts).toEqual(counts.toSorted((a, b) => a - b));
    expect(
      sortPlans(rows, "credits", DEFAULT_ASSUMPTIONS)
        .map((r) => r.id)
        .slice(0, 2),
    ).toEqual(["copilot-max", "copilot-pro"]);
  });

  it("筛选条件与 URL 互相转换，默认值不写", () => {
    expect(serializePlanFilters(DEFAULT_PLAN_FILTERS)).toBe("");
    const f = { q: "glm", region: "cn" as const, publishedOnly: true, sort: "breakEven" as const };
    const query = serializePlanFilters(f);
    expect(query).toBe("q=glm&region=cn&quota=published&psort=breakEven");
    expect(parsePlanFilters(`?${query}`)).toEqual(f);
    expect(parsePlanFilters("?region=eu&psort=hack&quota=x")).toEqual(DEFAULT_PLAN_FILTERS);
  });
});
