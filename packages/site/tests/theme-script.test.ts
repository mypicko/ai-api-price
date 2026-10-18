import { afterEach, describe, expect, it } from "vitest";
import {
  robotsResponse,
  rssResponse,
  rssXml,
  sitemapPaths,
  sitemapResponse,
} from "../src/lib/endpoints";
import { resetSiteModel } from "../src/lib/site-data";
import { THEME_SCRIPT } from "../src/lib/theme-script";
import { FIXTURE_DIR, fixtureModel } from "./helpers";

interface FakeEnv {
  readonly store: Record<string, string>;
  readonly prefersDark: boolean;
  readonly referrer: string;
  readonly locale: string;
}

function run(env: FakeEnv) {
  const classes = new Set<string>();
  const attrs: Record<string, string> = { "data-locale": env.locale, "data-alt-href": "/en/" };
  const replaced: string[] = [];
  const documentElement = {
    classList: { add: (c: string) => classes.add(c) },
    style: { colorScheme: "" },
    getAttribute: (k: string) => attrs[k] ?? null,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
  };
  const window = {
    localStorage: { getItem: (k: string) => env.store[k] ?? null },
    matchMedia: () => ({ matches: env.prefersDark }),
  };
  const location = {
    origin: "https://a.io",
    search: "?q=1",
    hash: "",
    replace: (u: string) => replaced.push(u),
  };
  new Function("window", "document", "location", THEME_SCRIPT)(
    window,
    { documentElement, referrer: env.referrer },
    location,
  );
  return { classes, attrs, replaced, colorScheme: documentElement.style.colorScheme };
}

describe("theme-script", () => {
  it("跟随系统暗色，并读取保存的币种", () => {
    const r = run({
      store: { "aipb.currency": "USD" },
      prefersDark: true,
      referrer: "",
      locale: "zh",
    });
    expect(r.classes.has("dark")).toBe(true);
    expect(r.colorScheme).toBe("dark");
    expect(r.attrs["data-currency"]).toBe("USD");
  });

  it("手动选择浅色优先于系统设置；非法币种忽略", () => {
    const r = run({
      store: { theme: "light", "aipb.currency": "JPY" },
      prefersDark: true,
      referrer: "",
      locale: "zh",
    });
    expect(r.classes.has("dark")).toBe(false);
    expect(r.attrs["data-currency"]).toBeUndefined();
  });

  it("从站外进入且偏好语言不同时跳转；站内跳转不处理", () => {
    expect(
      run({
        store: { "aipb.lang": "en" },
        prefersDark: false,
        referrer: "https://google.com/",
        locale: "zh",
      }).replaced,
    ).toEqual(["/en/?q=1"]);
    expect(
      run({
        store: { "aipb.lang": "en" },
        prefersDark: false,
        referrer: "https://a.io/x",
        locale: "zh",
      }).replaced,
    ).toEqual([]);
    expect(
      run({ store: { "aipb.lang": "zh" }, prefersDark: false, referrer: "", locale: "zh" })
        .replaced,
    ).toEqual([]);
  });
});

describe("endpoints", () => {
  afterEach(() => {
    delete process.env["DATA_DIR"];
    resetSiteModel();
  });

  it("RSS / sitemap / robots", async () => {
    process.env["DATA_DIR"] = FIXTURE_DIR;
    const rss = rssResponse("en", new URL("https://a.github.io/"));
    expect(rss.headers.get("Content-Type")).toContain("application/rss+xml");
    expect(await rss.text()).toContain("<language>en</language>");
    const sitemap = await sitemapResponse(undefined).text();
    expect(sitemap).toContain("<loc>http://localhost:4321/models/deepseek/deepseek-chat/</loc>");
    expect(await robotsResponse(new URL("https://a.github.io")).text()).toContain(
      "Sitemap: https://a.github.io/sitemap.xml",
    );
    const model = fixtureModel();
    expect(sitemapPaths(model)).toHaveLength(4 + model.models.length);
    expect(sitemapPaths(model)).not.toContain("media/");
    expect(rssXml(model, "zh", "https://a.io", "/x/")).toContain("https://a.io/x/models/");
  });
});
