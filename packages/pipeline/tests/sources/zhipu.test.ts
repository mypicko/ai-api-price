import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import { parseZhipuHtml, ZHIPU_URL, zhipuSource } from "../../src/sources/zhipu";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "zhipu/2026-10-18.html"), "utf8");
const byName = async (name: string) =>
  parseZhipuHtml(await loadFixture()).find((o) => o.modelName === name);

describe("source/zhipu", () => {
  it("解析出 ≥ 25 个文本/视觉模型，跳过按次计价的图像、视频、语音表", async () => {
    const offerings = parseZhipuHtml(await loadFixture());
    expect(offerings.length).toBeGreaterThanOrEqual(25);
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(expect.arrayContaining(["glm-5.3", "glm-5.2", "glm-4.7", "glm-4.6v"]));
    expect(names).not.toContain("cogview-4");
    expect(names).not.toContain("glm-tts");
    expect(new Set(names).size).toBe(names.length);
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("抽查 GLM-5.3：币种和单位来自表头", async () => {
    expect(await byName("glm-5.3")).toMatchObject({
      vendorHint: "zhipu",
      displayName: "GLM-5.3",
      currency: "CNY",
      unit: "per_1m",
      input: 8,
      output: 28,
      cacheRead: 2,
      contextWindow: 1_000_000,
      sourceUrl: ZHIPU_URL,
    });
  });

  it("抽查 GLM-5.1：按输入长度分档生成 tiers", async () => {
    const glm = await byName("glm-5.1");
    expect(glm).toMatchObject({ input: 6, output: 24, cacheRead: 1.3 });
    expect(glm?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 32_000, input: 6, output: 24, cacheRead: 1.3 },
      { minInputTokens: 32_000, maxInputTokens: null, input: 8, output: 28, cacheRead: 2 },
    ]);
  });

  it("抽查 GLM-4.7：输出长度分档只取每个输入档的第一行，并写 notes", async () => {
    const glm = await byName("glm-4.7");
    expect(glm?.tiers?.map((t) => [t.minInputTokens, t.maxInputTokens, t.input, t.output])).toEqual(
      [
        [0, 32_000, 2, 8],
        [32_000, 200_000, 4, 16],
      ],
    );
    expect(glm?.contextWindow).toBe(200_000);
    expect(glm?.notes).toContain("输出长度");
  });

  it("免费模型价格为 0，「不支持」的缓存价为 null，视觉模型带 image 模态", async () => {
    expect(await byName("glm-4.7-flash")).toMatchObject({ input: 0, output: 0, cacheRead: 0 });
    expect((await byName("glm-4-airx"))?.cacheRead).toBeNull();
    expect((await byName("glm-4.6v"))?.modalities).toEqual(["text", "image"]);
    expect((await byName("glm-5.3-flash"))?.modalities).toEqual(["text", "image", "video", "file"]);
  });

  it("页面没有价格表时抛 E2001", () => {
    expect(() =>
      parseZhipuHtml(
        "<table><tr><th>模型名称</th><th>单价</th></tr><tr><td>x</td><td>1 元/次</td></tr></table>",
      ),
    ).toThrow(/E2001/);
  });

  it("单元格无法识别时跳过该行并记录 W2003", () => {
    const write = vi.fn();
    const html = `<h2>文本模型</h2><table><thead><tr><th>模型名称</th><th>输入单价（元/百万 Tokens）</th><th>输出单价（元/百万 Tokens）</th></tr></thead>
      <tbody><tr><td>GLM-A</td><td>1</td><td>2</td></tr><tr><td>GLM-B</td><td>0.1 元/次</td><td>2</td></tr></tbody></table>`;
    const offerings = parseZhipuHtml(html, createLogger({ write }));
    expect(offerings.map((o) => o.modelName)).toEqual(["glm-a"]);
    expect(write.mock.calls.join("")).toContain("W2003");
  });

  it("fetch 通过 ctx.http 请求入口 URL", async () => {
    const http = createFakeHttp({ [ZHIPU_URL]: await loadFixture() });
    const offerings = await zhipuSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings.length).toBeGreaterThanOrEqual(25);
  });
});
