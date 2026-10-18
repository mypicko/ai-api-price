import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { DEEPSEEK_URL, deepseekSource, parseDeepseekHtml } from "../../src/sources/deepseek";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "deepseek/2026-10-18.html"), "utf8");

describe("source/deepseek", () => {
  it("解析出 2 个模型，模型名是 API 的 model 参数", async () => {
    const offerings = parseDeepseekHtml(await loadFixture());
    expect(offerings.map((o) => o.modelName)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("标准价取高峰时段，币种和单位从页面文字识别", async () => {
    const [flash, pro] = parseDeepseekHtml(await loadFixture());
    expect(flash).toMatchObject({
      vendorHint: "deepseek",
      displayName: "DeepSeek-V4.1-Flash-1017",
      currency: "CNY",
      unit: "per_1m",
      input: 2,
      output: 8,
      cacheRead: 0.04,
      contextWindow: 1_000_000,
      maxOutput: 384_000,
      sourceUrl: DEEPSEEK_URL,
    });
    expect(pro).toMatchObject({
      input: 9,
      output: 27,
      cacheRead: 0.3,
      displayName: "DeepSeek-V4-Pro-0813",
    });
  });

  it("空闲时段价格写进 notes", async () => {
    const [flash] = parseDeepseekHtml(await loadFixture());
    expect(flash?.notes).toContain("输入 1");
    expect(flash?.notes).toContain("缓存命中 0.02");
    expect(flash?.notes).toContain("输出 4");
    expect(flash?.notes?.length).toBeLessThanOrEqual(200);
  });

  it("没有分时段时直接取唯一的价格行", () => {
    const html = `<table>
      <tr><td colspan="2">模型</td><td>deepseek-chat</td></tr>
      <tr><td rowspan="3">价格</td><td>百万tokens输入（缓存命中）</td><td>0.5元</td></tr>
      <tr><td>百万tokens输入（缓存未命中）</td><td>2元</td></tr>
      <tr><td>百万tokens输出</td><td>3元</td></tr>
    </table>`;
    const [chat] = parseDeepseekHtml(html);
    expect(chat).toMatchObject({
      modelName: "deepseek-chat",
      input: 2,
      output: 3,
      cacheRead: 0.5,
      currency: "CNY",
      unit: "per_1m",
    });
    expect(chat?.notes).toBeUndefined();
    expect(chat?.contextWindow).toBeNull();
  });

  it("页面改版找不到价格表时抛 E2001", () => {
    expect(() => parseDeepseekHtml("<html><body>维护中</body></html>")).toThrow(/E2001/);
    const noPrice = `<table><tr><td>模型</td><td>x</td></tr><tr><td>百万tokens 上下文</td><td>1M</td></tr></table>`;
    expect(() => parseDeepseekHtml(noPrice)).toThrow(/E2001/);
  });

  it("单元格币种识别不了时抛 W2003", () => {
    const html = `<table><tr><td>模型</td><td>m</td></tr>
      <tr><td>百万tokens输入</td><td>2</td></tr><tr><td>百万tokens输出</td><td>3</td></tr></table>`;
    expect(() => parseDeepseekHtml(html)).toThrow(/W2003/);
  });

  it("fetch 通过 ctx.http 请求入口 URL", async () => {
    const http = createFakeHttp({ [DEEPSEEK_URL]: await loadFixture() });
    const offerings = await deepseekSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings).toHaveLength(2);
    expect(http.requests.map((r) => r.url)).toEqual([DEEPSEEK_URL]);
  });
});
