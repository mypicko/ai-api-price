import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import { ALIYUN_URL, aliyunSource, parseAliyunHtml } from "../../src/sources/aliyun";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "aliyun/2026-10-18.html"), "utf8");
const byName = async (name: string) =>
  parseAliyunHtml(await loadFixture()).find((o) => o.modelName === name);

const page = (h2: string, table: string) =>
  `<h2>${h2}</h2><section><h4>华北2（北京）</h4>${table}</section>`;

describe("source/aliyun", () => {
  it("只解析「文本生成」下的北京地域，≥ 50 个模型，排除第三方模型和图像/语音", async () => {
    const offerings = parseAliyunHtml(await loadFixture());
    expect(offerings.length).toBeGreaterThanOrEqual(50);
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(
      expect.arrayContaining(["qwen3.8-max", "qwen-plus", "qwen3.8-flash", "qwen3-vl-plus"]),
    );
    expect(names).not.toContain("deepseek-v4.1-flash");
    expect(names).not.toContain("kimi-k3");
    expect(names).not.toContain("qwen-image-3.0-pro");
    expect(names).not.toContain("text-embedding-v4");
    expect(new Set(names).size).toBe(names.length);
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("抽查 qwen3.8-max：北京地域美元价，取第一行（不是国际/新加坡地域）", async () => {
    expect(await byName("qwen3.8-max")).toMatchObject({
      vendorHint: "alibaba",
      currency: "USD",
      unit: "per_1m",
      input: 1.65,
      output: 4.951,
      sourceUrl: ALIYUN_URL,
    });
  });

  it("抽查 qwen-plus：按输入 Token 数分 3 档", async () => {
    const plus = await byName("qwen-plus");
    expect(plus).toMatchObject({ input: 0.115, output: 0.287 });
    expect(plus?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 128_000, input: 0.115, output: 0.287 },
      { minInputTokens: 128_000, maxInputTokens: 256_000, input: 0.345, output: 2.868 },
      { minInputTokens: 256_000, maxInputTokens: 1_000_000, input: 0.689, output: 6.881 },
    ]);
  });

  it("抽查 qwen3.7-plus：「原价$0.276（限时8折）」取原价并写 notes；有缓存命中列时填 cacheRead", async () => {
    const plus = await byName("qwen3.7-plus");
    expect(plus).toMatchObject({ input: 0.276, output: 1.101 });
    expect(plus?.notes).toContain("限时8折");
    expect((await byName("qwen3.8-omni-flash"))?.cacheRead).toBe(0.014);
  });

  it("忙时 / 闲时价格取忙时价，并写 notes", () => {
    const html = page(
      "文本生成-千问",
      `<table><thead><tr><th>模型 ID（Model ID）</th><th>输入单价（每百万Token）</th><th>输出单价（每百万Token）</th></tr></thead>
       <tbody><tr><td><p>qwen-x</p></td><td>忙时 $0.283闲时 $0.141</td><td>忙时 $1.131闲时 $0.565</td></tr>
       <tr><td><p>说明</p></td><td>-</td><td>-</td></tr></tbody></table>`,
    );
    const [x] = parseAliyunHtml(html);
    expect(x).toMatchObject({ modelName: "qwen-x", input: 0.283, output: 1.131 });
    expect(x?.notes).toContain("闲时");
  });

  it("价格单位识别不了的行跳过并记录 W2003", () => {
    const write = vi.fn();
    const html = page(
      "文本生成-千问",
      `<table><thead><tr><th>模型 ID（Model ID）</th><th>输入单价</th><th>输出单价</th></tr></thead>
       <tbody><tr><td>qwen-a</td><td>$1/百万Token</td><td>$2/百万Token</td></tr><tr><td>qwen-b</td><td>$1</td><td>$2</td></tr></tbody></table>`,
    );
    expect(parseAliyunHtml(html, createLogger({ write })).map((o) => o.modelName)).toEqual([
      "qwen-a",
    ]);
    expect(write.mock.calls.join("")).toContain("W2003");
  });

  it("找不到北京地域区块或没有可识别模型时抛 E2001", () => {
    expect(() => parseAliyunHtml("<h2>文本生成</h2><section><h4>新加坡</h4></section>")).toThrow(
      /E2001/,
    );
    expect(() =>
      parseAliyunHtml(page("文本生成-千问", "<table><tr><th>模型 ID</th></tr></table>")),
    ).toThrow(/E2001/);
  });

  it("fetch 通过 ctx.http 请求入口 URL", async () => {
    const http = createFakeHttp({ [ALIYUN_URL]: await loadFixture() });
    const offerings = await aliyunSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings.length).toBeGreaterThanOrEqual(50);
  });
});
