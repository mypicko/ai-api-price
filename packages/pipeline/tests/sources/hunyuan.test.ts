import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { HUNYUAN_URL, hunyuanSource, parseHunyuanHtml } from "../../src/sources/hunyuan";
import { ALL_SOURCES } from "../../src/sources/registry";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "hunyuan/2026-11-20.html"), "utf8");
const byName = async (name: string) =>
  parseHunyuanHtml(await loadFixture()).find((o) => o.modelName === name);

const HEADERS =
  "<tr><th>模型名称</th><th>model（调用参数）</th><th>条件 （token）</th><th>峰谷计费</th><th>推理输入 （元/百万 tokens）</th><th>推理输出 （元/百万 tokens）</th><th>缓存命中 （元/百万 tokens）</th></tr>";
const page = (rows: string, notice = "") =>
  `<p>${notice}</p><h3>语言模型</h3><h4>按 Token 计费（后付费）</h4><table>${HEADERS}${rows}</table>`;
const row = (cells: readonly string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;

describe("source/hunyuan（腾讯混元 TokenHub 国内站人民币价）", () => {
  it("只收腾讯自家的 Hy / Hunyuan 模型，不收 TokenHub 转售的 DeepSeek、GLM、Kimi 等", async () => {
    const offerings = parseHunyuanHtml(await loadFixture());
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(
      expect.arrayContaining(["hy4-flash", "hy4", "hy4-preview", "hy3", "hy-mt2-pro", "hy-role"]),
    );
    expect(names.every((n) => /^(hy|hunyuan)/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        vendorHint: "tencent",
        currency: "CNY",
        unit: "per_1m",
        sourceUrl: HUNYUAN_URL,
      });
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
  });

  it("只取第一张表（广州地域），不被后面的新加坡地域覆盖；抽查价格", async () => {
    expect(await byName("hy4-flash")).toMatchObject({
      displayName: "Hy4 flash",
      input: 0.5,
      output: 2,
      cacheRead: 0.02,
    });
    expect(await byName("hy3")).toMatchObject({ input: 1, output: 4, cacheRead: 0.25 });
    expect(await byName("hy-mt2-lite")).toMatchObject({ input: 0.3, output: 1.2 });
    expect((await byName("hy-mt2-lite"))?.cacheRead).toBeUndefined();
  });

  it("页面开头的「限时折扣说明」写进对应模型的备注，表中为目录价", async () => {
    expect((await byName("hy4-flash"))?.notes).toContain("2026-11-30");
    expect((await byName("hy4"))?.notes).toContain("2026-12-31");
    expect((await byName("hy4"))?.notes).toContain("目录价");
    expect((await byName("hy3"))?.notes).toBeUndefined();
  });

  it("按输入长度分档生成阶梯价；峰谷计费取高峰时段，空闲时段写进备注", () => {
    const html = page(
      row(["Hy-X", "hy-x", "输入长度（0, 32k]", "-", "1", "4", "0.1"]) +
        row(["Hy-X", "hy-x", "输入长度 32k+", "-", "2", "8", "0.2"]) +
        row(["Hy-Y", "hy-y", "-", "空闲时段", "0.5", "2", "-"]) +
        row(["Hy-Y", "hy-y", "-", "高峰时段", "1", "4", "-"]),
    );
    const [x, y] = parseHunyuanHtml(html);
    expect(x).toMatchObject({ input: 1, output: 4, cacheRead: 0.1 });
    expect(x?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 32000, input: 1, output: 4 },
      { minInputTokens: 32000, maxInputTokens: null, input: 2, output: 8 },
    ]);
    expect(y).toMatchObject({ input: 1, output: 4 });
    expect(y?.notes).toContain("空闲时段");
  });

  it("注册为 official-cn 平台，优先级高于人工核对的 manual-cn", async () => {
    expect(ALL_SOURCES).toContain(hunyuanSource);
    expect(hunyuanSource.platform).toBe("official-cn");
    expect(sourcePriority("hunyuan")).toBeGreaterThan(sourcePriority("manual-cn"));
    const ctx = {
      http: createFakeHttp({ [HUNYUAN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect((await hunyuanSource.fetch(ctx)).length).toBeGreaterThanOrEqual(9);
  });

  it("页面改版找不到价格表时报 E2001", () => {
    expect(() => parseHunyuanHtml("<h3>语言模型</h3><p>改版了</p>")).toThrow(/hunyuan/);
  });
});
