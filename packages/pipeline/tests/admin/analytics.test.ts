import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_GRAPHQL_URL,
  fetchCloudflareAnalytics,
  parseAnalyticsEnv,
  parseCloudflareResponse,
} from "../../src/admin/analytics";

const group = (count: number, dimensions: Record<string, string>, visits?: number) => ({
  count,
  ...(visits === undefined ? {} : { sum: { visits } }),
  dimensions,
});

const SAMPLE = {
  data: {
    viewer: {
      accounts: [
        {
          daily: [group(120, { date: "2026-10-30" }, 80), group(150, { date: "2026-10-31" }, 95)],
          paths: [group(60, { requestPath: "/ai-api-price/" })],
          referers: [group(30, { refererHost: "www.google.com" }), group(5, { refererHost: "" })],
          countries: [group(100, { countryName: "CN" })],
        },
      ],
    },
  },
  errors: null,
};

describe("访问数据（Cloudflare Web Analytics）", () => {
  it("parseAnalyticsEnv：三项都填才启用，缺项时说明缺什么", () => {
    expect(parseAnalyticsEnv({})).toEqual({
      ok: false,
      missing: ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_SITE_TAG"],
    });
    expect(parseAnalyticsEnv({ CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a", CF_SITE_TAG: "s" })).toEqual({
      ok: true,
      config: { apiToken: "t", accountId: "a", siteTag: "s" },
    });
  });

  it("parseCloudflareResponse：每日浏览量和访客、热门页面、来源（空来源记为直接访问）、国家", () => {
    expect(parseCloudflareResponse(SAMPLE)).toEqual({
      daily: [
        { date: "2026-10-30", pageViews: 120, visits: 80 },
        { date: "2026-10-31", pageViews: 150, visits: 95 },
      ],
      totals: { pageViews: 270, visits: 175 },
      topPaths: [{ label: "/ai-api-price/", count: 60 }],
      topReferers: [
        { label: "www.google.com", count: 30 },
        { label: "直接访问", count: 5 },
      ],
      topCountries: [{ label: "CN", count: 100 }],
    });
  });

  it("parseCloudflareResponse：接口返回 errors 时抛出它的错误信息", () => {
    expect(() =>
      parseCloudflareResponse({
        data: null,
        errors: [{ message: "not authorized for that account" }],
      }),
    ).toThrow(/not authorized/);
  });

  it("fetchCloudflareAnalytics：带 Bearer 令牌 POST 到 GraphQL，按站点和日期范围查询", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(SAMPLE), { status: 200 });
    }) as typeof fetch;
    const result = await fetchCloudflareAnalytics(
      { apiToken: "tok", accountId: "acc", siteTag: "site" },
      { days: 7, now: new Date("2026-10-31T12:00:00Z"), fetchImpl },
    );
    expect(result.totals.pageViews).toBe(270);
    expect(calls[0]?.url).toBe(CLOUDFLARE_GRAPHQL_URL);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.variables).toEqual({
      accountTag: "acc",
      filter: {
        AND: [
          { datetime_geq: "2026-10-25T00:00:00Z", datetime_leq: "2026-10-31T12:00:00Z" },
          { siteTag: "site" },
        ],
      },
    });
  });

  it("fetchCloudflareAnalytics：HTTP 失败时报错，不带令牌", async () => {
    const fetchImpl = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
    const error = await fetchCloudflareAnalytics(
      { apiToken: "secret-token", accountId: "acc", siteTag: "site" },
      { days: 7, now: new Date("2026-10-31T12:00:00Z"), fetchImpl },
    ).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("403");
    expect(message).not.toContain("secret-token");
  });
});
