import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { parseQianfanHtml, QIANFAN_URL, qianfanSource } from "../../src/sources/qianfan";
import { ALL_SOURCES } from "../../src/sources/registry";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "qianfan/2026-11-20.html"), "utf8");
const byName = async (name: string) =>
  parseQianfanHtml(await loadFixture()).find((o) => o.modelName === name);

/** 最小页面：h3 章节 + h4「按量后付费」+ 一张价格表 */
const page = (h3: string, rows: string) =>
  `<h3>${h3}</h3><h4>按量后付费</h4><table><tr><th>模型名称</th><th>版本名称</th><th>服务内容</th><th>子项</th><th>在线推理</th><th>批量推理</th><th>单位</th></tr>${rows}</table>`;

describe("source/qianfan（百度千帆国内站人民币价）", () => {
  it("只收百度自家 ERNIE 模型，不收千帆转售的 DeepSeek / GLM / Kimi 等", async () => {
    const offerings = parseQianfanHtml(await loadFixture());
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(
      expect.arrayContaining(["ERNIE-5.5-Flash", "ERNIE-5.1", "ERNIE-Light-DT"]),
    );
    expect(names.every((n) => n.startsWith("ERNIE"))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        vendorHint: "baidu",
        currency: "CNY",
        unit: "per_1k",
        sourceUrl: QIANFAN_URL,
      });
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
  });

  it("峰谷计价取高峰时段原价，活动价和空闲时段写进备注", async () => {
    const flash = await byName("ERNIE-5.5-Flash");
    expect(flash).toMatchObject({ input: 0.002, output: 0.008, cacheRead: 0.0002 });
    expect(flash?.notes).toContain("空闲时段");
    expect(flash?.notes).toContain("活动价");
  });

  it("按输入长度分档的价格生成阶梯价", async () => {
    const ernie51 = await byName("ERNIE-5.1");
    expect(ernie51).toMatchObject({ displayName: "ERNIE 5.1", input: 0.004, output: 0.018 });
    expect(ernie51?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 32000, input: 0.004, output: 0.018 },
      { minInputTokens: 32000, maxInputTokens: 128000, input: 0.006, output: 0.022 },
    ]);
    expect(await byName("ERNIE-Light-DT")).toMatchObject({
      input: 0.008,
      output: 0.028,
      cacheRead: 0.0008,
    });
  });

  it("同一模型出现在多个章节时只取第一次出现的", () => {
    const row = (price: string) =>
      `<tr><td rowspan="2">ERNIE-X</td><td rowspan="2">ERNIE-X</td><td rowspan="2">推理服务</td><td>输入</td><td>${price}</td><td>-</td><td>元/千tokens</td></tr><tr><td>输出</td><td>0.01</td><td>-</td><td>元/千tokens</td></tr>`;
    const html = page("文本生成", row("0.001")) + page("深度思考", row("0.009"));
    expect(parseQianfanHtml(html)).toEqual([expect.objectContaining({ input: 0.001 })]);
  });

  it("注册为 official-cn 平台，优先级高于人工核对的 manual-cn", async () => {
    expect(ALL_SOURCES).toContain(qianfanSource);
    expect(qianfanSource.platform).toBe("official-cn");
    expect(sourcePriority("qianfan")).toBeGreaterThan(sourcePriority("manual-cn"));
    const ctx = {
      http: createFakeHttp({ [QIANFAN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect((await qianfanSource.fetch(ctx)).length).toBeGreaterThanOrEqual(3);
  });

  it("页面改版找不到价格表时报 E2001", () => {
    expect(() => parseQianfanHtml("<h3>文本生成</h3><p>改版了</p>")).toThrow(/E2001|qianfan/);
  });
});
