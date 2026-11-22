import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { MINIMAX_CN_URL, minimaxCnSource, parseMinimaxCnHtml } from "../../src/sources/minimax-cn";
import { ALL_SOURCES } from "../../src/sources/registry";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "minimax-cn/2026-11-22.html"), "utf8");
const byName = async (name: string) =>
  parseMinimaxCnHtml(await loadFixture()).find((o) => o.modelName === name);

const HEAD =
  "<thead><tr><th>模型</th><th>输入价格 元/百万 tokens</th><th>输出价格 元/百万 tokens</th><th>缓存读取 元/百万 tokens</th></tr></thead>";
const table = (rows: string) => `<table>${HEAD}<tbody>${rows}</tbody></table>`;
const panel = (label: string, rows: string) =>
  `<div role="tabpanel" aria-labelledby="${encodeURIComponent(label)}">${table(rows)}</div>`;

describe("source/minimax-cn（MiniMax 国内站人民币价）", () => {
  it("只收语言模型（输入 + 输出价表），视频 / 图片 / 语音表跳过", async () => {
    const offerings = parseMinimaxCnHtml(await loadFixture());
    expect(offerings.map((o) => o.modelName).sort()).toEqual(["MiniMax-M3", "MiniMax-M3.1-Flash"]);
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        vendorHint: "minimax",
        currency: "CNY",
        unit: "per_1m",
        sourceUrl: MINIMAX_CN_URL,
      });
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
    expect(await byName("MiniMax-M3.1-Flash")).toMatchObject({
      input: 1,
      output: 4,
      cacheRead: 0.1,
    });
  });

  it("「永久五折」取折后价（实际扣费），原价写进备注；按输入长度分档；不取「优先」服务的 1.5 倍价", async () => {
    const m3 = await byName("MiniMax-M3");
    expect(m3).toMatchObject({ input: 2.1, output: 8.4, cacheRead: 0.42 });
    expect(m3?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 512000, input: 2.1, output: 8.4 },
      { minInputTokens: 512000, maxInputTokens: null, input: 4.2, output: 16.8 },
    ]);
    expect(m3?.notes).toContain("永久五折");
    expect(m3?.notes).toContain("4.2");
  });

  it("没有折扣时直接取价格，没有备注", () => {
    const html =
      panel(
        "标准",
        "<tr><td><strong>MiniMax-X</strong></td><td>1.00</td><td>4.00</td><td>-</td></tr>",
      ) +
      panel(
        "优先",
        "<tr><td><strong>MiniMax-X</strong></td><td>1.50</td><td>6.00</td><td>-</td></tr>",
      );
    const [x] = parseMinimaxCnHtml(html);
    expect(x).toMatchObject({ modelName: "MiniMax-X", input: 1, output: 4 });
    expect(x?.cacheRead).toBeUndefined();
    expect(x?.notes).toBeUndefined();
  });

  it("注册为 official-cn 平台，优先级高于 models.dev 的社区数据", async () => {
    expect(ALL_SOURCES).toContain(minimaxCnSource);
    expect(minimaxCnSource.platform).toBe("official-cn");
    expect(sourcePriority("minimax-cn")).toBeGreaterThan(sourcePriority("modelsdev-cn"));
    const ctx = {
      http: createFakeHttp({ [MINIMAX_CN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect(await minimaxCnSource.fetch(ctx)).toHaveLength(2);
  });

  it("页面改版找不到语言模型价格表时报 E2001", () => {
    expect(() => parseMinimaxCnHtml("<p>改版了</p>")).toThrow(/minimax-cn/);
  });
});
