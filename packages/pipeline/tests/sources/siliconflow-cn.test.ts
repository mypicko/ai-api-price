import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { ALL_SOURCES } from "../../src/sources/registry";
import {
  parseSiliconflowCnHtml,
  SILICONFLOW_CN_URL,
  siliconflowCnSource,
} from "../../src/sources/siliconflow-cn";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "siliconflow-cn/2026-11-20.html"), "utf8");
const byName = async (name: string) =>
  parseSiliconflowCnHtml(await loadFixture()).find((o) => o.modelName === name);

/** 最小页面：「对话模型」标题 + 一行（模型链接 + 价格格子） */
const cellHtml = (label: string, price: string) =>
  `<div><span><span>${label}</span></span><span>${price}</span></div>`;
const rowHtml = (id: string, cells: readonly (readonly [string, string])[]) =>
  `<div class="grid"><div><a href="https://cloud.siliconflow.cn/models?target=${encodeURIComponent(id)}" title="${id}">${id.split("/")[1]}</a></div>${cells.map(([l, p]) => cellHtml(l, p)).join("")}</div>`;
const page = (rows: string, section = "对话模型") => `<div><span>${section}</span></div>${rows}`;

describe("source/siliconflow-cn（硅基流动国内站人民币价）", () => {
  it("只收「对话模型」，厂商取组织名、模型名取斜杠后部分（与 models.dev 的硅基流动国内站一致）", async () => {
    const offerings = parseSiliconflowCnHtml(await loadFixture());
    expect(offerings.length).toBeGreaterThanOrEqual(20);
    const names = offerings.map((o) => o.modelName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("Kolors");
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        currency: "CNY",
        unit: "per_1m",
        sourceUrl: SILICONFLOW_CN_URL,
      });
      expect(offering.displayName).toBe(`${offering.vendorHint}/${offering.modelName}`);
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
  });

  it("分时段计价取高峰时段（不论页面先列哪个时段），闲时写进备注", async () => {
    const v41 = await byName("DeepSeek-V4.1-Flash");
    expect(v41).toMatchObject({ vendorHint: "deepseek-ai", input: 2, output: 8, cacheRead: 0.04 });
    expect(v41?.notes).toContain("2点～8点");
    // 这个模型页面上先列 2点～8点（闲时），后列高峰
    expect(await byName("DeepSeek-V4-Flash")).toMatchObject({
      input: 3,
      output: 9,
      cacheRead: 0.3,
    });
  });

  it("按输入长度分档生成阶梯价；缓存价「-」记为没有缓存价", async () => {
    const qwen = await byName("Qwen3.5-35B-A3B");
    expect(qwen).toMatchObject({ vendorHint: "Qwen", input: 0.4, output: 3.2 });
    expect(qwen?.cacheRead).toBeUndefined();
    expect(qwen?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 128000, input: 0.4, output: 3.2 },
      { minInputTokens: 128000, maxInputTokens: null, input: 1.6, output: 12.8 },
    ]);
  });

  it("「免费」记为 0；生图等其他分类不收", () => {
    const html =
      page(
        rowHtml("Qwen/Qwen3-8B", [
          ["", "免费"],
          ["", "免费"],
          ["", "-"],
        ]),
      ) +
      page(
        rowHtml("Kwai-Kolors/Kolors", [
          ["", "¥ 0.04"],
          ["", "-"],
          ["", "-"],
        ]),
        "生图模型",
      );
    expect(parseSiliconflowCnHtml(html)).toEqual([
      expect.objectContaining({ modelName: "Qwen3-8B", input: 0, output: 0 }),
    ]);
  });

  it("跳过没有输出价的向量 / 重排序模型和 Pro/ 加速版", async () => {
    const names = (await parseSiliconflowCnHtml(await loadFixture())).map((o) => o.displayName);
    expect(names).not.toContain("BAAI/bge-m3");
    expect(names.some((n) => n?.startsWith("Pro/"))).toBe(false);
    expect(names).toContain("deepseek-ai/DeepSeek-V4.1-Flash");
  });

  it("注册为 siliconflow-cn 平台，优先级高于 models.dev 的社区数据", async () => {
    expect(ALL_SOURCES).toContain(siliconflowCnSource);
    expect(siliconflowCnSource.platform).toBe("siliconflow-cn");
    expect(sourcePriority("siliconflow-cn")).toBeGreaterThan(
      sourcePriority("modelsdev-siliconflow-cn"),
    );
    const ctx = {
      http: createFakeHttp({ [SILICONFLOW_CN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect((await siliconflowCnSource.fetch(ctx)).length).toBeGreaterThanOrEqual(20);
  });

  it("页面改版找不到对话模型时报 E2001", () => {
    expect(() => parseSiliconflowCnHtml("<div>改版了</div>")).toThrow(/siliconflow-cn/);
  });
});
