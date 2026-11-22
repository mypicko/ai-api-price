import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { ALL_SOURCES } from "../../src/sources/registry";
import { parseStepfunCnHtml, STEPFUN_CN_URL, stepfunCnSource } from "../../src/sources/stepfun-cn";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "stepfun-cn/2026-11-22.html"), "utf8");

describe("source/stepfun-cn（阶跃星辰国内站人民币价）", () => {
  it("只收「文本与多模态模型」表（Model ID + 输入 / 输出价），语音等按次计价的表跳过", async () => {
    const offerings = parseStepfunCnHtml(await loadFixture());
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(
      expect.arrayContaining([
        "step-5-preview",
        "step-3.7-flash",
        "step-3.5-flash",
        "step-1o-turbo-vision",
      ]),
    );
    expect(names.some((n) => n.startsWith("stepaudio"))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        vendorHint: "stepfun",
        currency: "CNY",
        unit: "per_1m",
        sourceUrl: STEPFUN_CN_URL,
      });
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
  });

  it("抽查价格：缓存命中记为缓存读取价", async () => {
    const offerings = parseStepfunCnHtml(await loadFixture());
    expect(offerings.find((o) => o.modelName === "step-5-preview")).toMatchObject({
      input: 7,
      output: 20,
      cacheRead: 0.7,
    });
    expect(offerings.find((o) => o.modelName === "step-3.5-flash")).toMatchObject({
      input: 0.7,
      output: 2.1,
      cacheRead: 0.14,
    });
  });

  it("注册为 official-cn 平台，优先级高于 models.dev 的社区数据", async () => {
    expect(ALL_SOURCES).toContain(stepfunCnSource);
    expect(stepfunCnSource.platform).toBe("official-cn");
    expect(sourcePriority("stepfun-cn")).toBeGreaterThan(sourcePriority("modelsdev-cn"));
    const ctx = {
      http: createFakeHttp({ [STEPFUN_CN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect((await stepfunCnSource.fetch(ctx)).length).toBeGreaterThanOrEqual(5);
  });

  it("页面改版找不到价格表时报 E2001", () => {
    expect(() => parseStepfunCnHtml("<p>改版了</p>")).toThrow(/stepfun-cn/);
  });
});
