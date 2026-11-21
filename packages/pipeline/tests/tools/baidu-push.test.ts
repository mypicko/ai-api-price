import { describe, expect, it, vi } from "vitest";
import {
  BAIDU_PUSH_ENDPOINT,
  parseSitemapLocs,
  pickUrls,
  pushToBaidu,
  runBaiduPush,
} from "../../src/tools/baidu-push";

const SITE = "https://promptso.top";
const sitemap = (paths: readonly string[]) =>
  `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc><xhtml:link href="${SITE}/x/"/></url>`).join("")}</urlset>`;
const ALL = [
  "/",
  "/en/",
  "/calculator/",
  "/changes/",
  "/models/a/one/",
  "/en/models/a/one/",
  "/models/b/two/",
  "/plans/",
];

describe("百度普通收录推送（DEV §3.29）", () => {
  it("从 sitemap 只取 <loc>，不取 hreflang 链接", () => {
    expect(parseSitemapLocs(sitemap(["/", "/en/"]))).toEqual([`${SITE}/`, `${SITE}/en/`]);
  });

  it("先推首页、变动页和当天有变动的模型页（中文），再按日期轮换补满额度，不重复", () => {
    const urls = pickUrls({
      locs: ALL.map((p) => SITE + p),
      changedSlugs: ["b/two", "zz/not-in-sitemap"],
      dayIndex: 0,
      limit: 5,
    });
    expect(urls.slice(0, 3)).toEqual([`${SITE}/`, `${SITE}/changes/`, `${SITE}/models/b/two/`]);
    expect(urls).toHaveLength(5);
    expect(new Set(urls).size).toBe(5);
    // 轮换部分中文页排在英文页前面
    expect(urls[3]).not.toContain("/en/");
  });

  it("轮换起点随日期变化，几天下来覆盖全部页面", () => {
    const locs = ALL.map((p) => SITE + p);
    const seen = new Set<string>();
    for (let day = 0; day < 4; day += 1)
      pickUrls({ locs, changedSlugs: [], dayIndex: day, limit: 4 }).forEach((u) => seen.add(u));
    expect(seen.size).toBe(locs.length);
  });

  it("按百度接口格式提交：text/plain、每行一个网址，site 带协议", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: 2, remain: 8 }));
    const result = await pushToBaidu({
      site: SITE,
      token: "tok",
      urls: ["a", "b"],
      fetchImpl,
    });
    expect(result).toEqual({ success: 2, remain: 8 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // 与百度后台给的调用地址完全一致：site 不做 URL 编码
    expect(url).toBe(`${BAIDU_PUSH_ENDPOINT}?site=${SITE}&token=tok`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("a\nb");
    expect(new Headers(init.headers).get("content-type")).toBe("text/plain");
  });

  it("百度返回错误时报 E5001，错误信息里不带令牌", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: 401, message: "token is not valid" }, { status: 401 }),
    );
    const promise = pushToBaidu({ site: SITE, token: "secretTok9", urls: ["a"], fetchImpl });
    await expect(promise).rejects.toThrow(/E5001.*token is not valid/);
    await expect(promise).rejects.not.toThrow(/secretTok9/);
  });

  it("当天额度用完（over quota）不算失败，返回成功 0 条", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: 400, message: "over quota" }, { status: 400 }),
    );
    await expect(
      pushToBaidu({ site: SITE, token: "tok", urls: ["a"], fetchImpl }),
    ).resolves.toEqual({ success: 0, remain: 0 });
  });

  it("令牌只能是字母和数字，否则不发请求", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ success: 1, remain: 1 }));
    await expect(
      pushToBaidu({ site: SITE, token: "a&b=c", urls: ["a"], fetchImpl }),
    ).rejects.toThrow(/E5001/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("没配置令牌时跳过；有令牌时读线上 sitemap 再推送", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/sitemap.xml")
        ? new Response(sitemap(ALL))
        : Response.json({ success: 3, remain: 0 }),
    );
    const skipped = await runBaiduPush({
      env: { CN_SITE_URL: SITE },
      changedSlugs: [],
      date: "2026-11-22",
      fetchImpl,
    });
    expect(skipped.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();

    const done = await runBaiduPush({
      env: { CN_SITE_URL: `${SITE}/`, BAIDU_PUSH_TOKEN: "tok", BAIDU_PUSH_LIMIT: "3" },
      changedSlugs: [],
      date: "2026-11-22",
      fetchImpl,
    });
    expect(done).toMatchObject({ status: "pushed", success: 3, remain: 0 });
    expect(done.status === "pushed" ? done.urls : []).toHaveLength(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`${SITE}/sitemap.xml`);
  });
});
