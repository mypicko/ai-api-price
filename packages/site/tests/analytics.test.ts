import { describe, expect, it } from "vitest";
import { analyticsCspSources, analyticsScript, parseAnalyticsConfig } from "../src/lib/analytics";

const CF_TOKEN = "0123456789abcdef0123456789abcdef";
const UMAMI_ID = "3f2c1b9e-8a7d-4c6b-9e5f-1a2b3c4d5e6f";

describe("analytics 配置", () => {
  it("未设置时关闭", () => {
    expect(parseAnalyticsConfig({})).toBeNull();
    expect(parseAnalyticsConfig({ ANALYTICS_PROVIDER: "" })).toBeNull();
    expect(analyticsScript(null)).toBeNull();
    expect(analyticsCspSources(null)).toEqual({ script: [], connect: [] });
  });

  it("Cloudflare：校验 token，生成 beacon 脚本和 CSP 白名单", () => {
    const config = parseAnalyticsConfig({
      ANALYTICS_PROVIDER: "cloudflare",
      ANALYTICS_TOKEN: CF_TOKEN,
    });
    expect(config).toEqual({ provider: "cloudflare", token: CF_TOKEN });
    expect(analyticsScript(config)).toEqual({
      src: "https://static.cloudflareinsights.com/beacon.min.js",
      attrs: { "data-cf-beacon": JSON.stringify({ token: CF_TOKEN }) },
    });
    expect(analyticsCspSources(config)).toEqual({
      script: ["https://static.cloudflareinsights.com"],
      connect: ["https://cloudflareinsights.com"],
    });
  });

  it("Umami：默认使用官方云，支持自建地址", () => {
    const cloud = parseAnalyticsConfig({ ANALYTICS_PROVIDER: "umami", ANALYTICS_TOKEN: UMAMI_ID });
    expect(analyticsScript(cloud)).toEqual({
      src: "https://cloud.umami.is/script.js",
      attrs: { "data-website-id": UMAMI_ID },
    });
    expect(analyticsCspSources(cloud).connect).toEqual(
      expect.arrayContaining(["https://cloud.umami.is", "https://api-gateway.umami.dev"]),
    );
    const self = parseAnalyticsConfig({
      ANALYTICS_PROVIDER: "umami",
      ANALYTICS_TOKEN: UMAMI_ID,
      ANALYTICS_SCRIPT_URL: "https://stats.example.com/script.js",
    });
    expect(analyticsScript(self)?.src).toBe("https://stats.example.com/script.js");
    expect(analyticsCspSources(self)).toEqual({
      script: ["https://stats.example.com"],
      connect: ["https://stats.example.com"],
    });
  });

  it("配置不合法时直接报错，避免静默失效或注入", () => {
    expect(() => parseAnalyticsConfig({ ANALYTICS_PROVIDER: "google" })).toThrow(
      /ANALYTICS_PROVIDER/,
    );
    expect(() =>
      parseAnalyticsConfig({ ANALYTICS_PROVIDER: "cloudflare", ANALYTICS_TOKEN: "abc'; alert(1)" }),
    ).toThrow(/ANALYTICS_TOKEN/);
    expect(() =>
      parseAnalyticsConfig({ ANALYTICS_PROVIDER: "umami", ANALYTICS_TOKEN: "nope" }),
    ).toThrow(/ANALYTICS_TOKEN/);
    expect(() =>
      parseAnalyticsConfig({
        ANALYTICS_PROVIDER: "umami",
        ANALYTICS_TOKEN: UMAMI_ID,
        ANALYTICS_SCRIPT_URL: "http://stats.example.com/script.js",
      }),
    ).toThrow(/ANALYTICS_SCRIPT_URL/);
  });
});
