import { describe, expect, it } from "vitest";
import { CnIntlPayloadSchema } from "@aipb/shared";
import { cnIntlPayload, cnIntlRows, cnIntlSummary } from "../src/lib/cn-intl";
import { allGaps } from "../src/lib/gap";
import { buildSiteModel } from "../src/lib/site-model";
import { fixtureData, fixtureModel, NOW } from "./helpers";

/** 在夹具上加一组「国内站人民币价 + 国际站美元官方价」 */
function withIntl(cnInput: number, cnOutput: number, usdInput: number, usdOutput: number) {
  const data = fixtureData();
  const latest = data.latest;
  if (!latest) throw new Error("fixture");
  const base = latest.offerings.find((o) => o.id === "openrouter:moonshot/kimi-k2");
  if (!base) throw new Error("fixture");
  const cn = {
    ...base,
    id: "official-cn:moonshot/kimi-k2",
    platform: "official-cn",
    currency: "CNY" as const,
    input: cnInput,
    output: cnOutput,
  };
  const intl = {
    ...base,
    id: "official:moonshot/kimi-k2",
    platform: "official",
    currency: "USD" as const,
    input: usdInput,
    output: usdOutput,
  };
  const offerings = latest.offerings
    .filter((o) => o.id !== cn.id && o.id !== intl.id)
    .concat([cn, intl]);
  return buildSiteModel({ ...data, latest: { ...latest, offerings } }, NOW);
}

describe("cn-intl：国内原价 vs 海外价（DEV §3.32）", () => {
  it("有国内官方价、且有海外官方价或 OpenRouter 价的模型都列出；OpenRouter 价差与首页价差榜一致", () => {
    const model = fixtureModel();
    const rows = cnIntlRows(model);
    const gaps = allGaps(model);
    for (const g of gaps) {
      const row = rows.find((r) => r.modelSlug === g.modelSlug);
      expect(row?.openrouterPct).toBeCloseTo(g.pct, 10);
    }
    expect(rows.every((r) => r.domestic.currency === "CNY")).toBe(true);
  });

  it("海外官方价差 = (国内 − 海外官方) / 海外官方，按混合价（美元）比较", () => {
    const model = withIntl(4, 16, 1, 4);
    const row = cnIntlRows(model).find((r) => r.modelSlug === "moonshot/kimi-k2");
    if (!row?.intl || row.intlPct === null) throw new Error("应有海外官方价");
    const a = row.domestic.blended?.usd ?? 0;
    const b = row.intl.blended?.usd ?? 0;
    expect(row.intlPct).toBeCloseTo((a - b) / b, 10);
    expect(row.intl.currency).toBe("USD");
  });

  it("有 OpenRouter 价的排前面，按「国内便宜多少」从多到少", () => {
    const rows = cnIntlRows(withIntl(1, 4, 1, 4));
    const withOr = rows.filter((r) => r.openrouterPct !== null);
    expect(rows.slice(0, withOr.length)).toEqual(withOr);
    const pcts = withOr.map((r) => r.openrouterPct ?? 0);
    expect(pcts).toEqual(pcts.toSorted((a, b) => a - b));
  });

  it("阿里的 official 是北京地域美元价，不算海外官方价", () => {
    const model = fixtureModel();
    const ali = cnIntlRows(model).find((r) => r.vendor === "alibaba");
    expect(ali?.intl ?? null).toBeNull();
  });

  it("汇总：对比的模型数，以及国内更便宜的个数", () => {
    const rows = cnIntlRows(withIntl(1, 4, 1, 4));
    const s = cnIntlSummary(rows);
    expect(s.total).toBe(rows.length);
    expect(s.intl.compared).toBe(rows.filter((r) => r.intlPct !== null).length);
    expect(s.intl.cheaper).toBe(rows.filter((r) => (r.intlPct ?? 0) < 0).length);
    expect(s.openrouter.cheaper).toBe(rows.filter((r) => (r.openrouterPct ?? 0) < 0).length);
  });

  it("接口 cn-vs-intl.json：价格换算成人民币，结构通过共享 schema 校验", () => {
    const model = withIntl(4, 16, 1, 4);
    const payload = cnIntlPayload(model);
    expect(CnIntlPayloadSchema.safeParse(payload).success).toBe(true);
    const kimi = payload.data.items.find((i) => i.modelSlug === "moonshot/kimi-k2");
    expect(kimi?.domestic).toEqual({ input: 4, output: 16 });
    expect(kimi?.intl?.input).toBeCloseTo(model.data.fx.latest.usdCny, 6);
    expect(payload.meta.count).toBe(payload.data.items.length);
  });
});
