import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { ALIYUN_CN_URL, aliyunCnSource, parseAliyunCnHtml } from "../../src/sources/aliyun";
import { ALL_SOURCES } from "../../src/sources/registry";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "aliyun-cn/2026-11-20.html"), "utf8");
const byName = async (name: string) =>
  parseAliyunCnHtml(await loadFixture()).find((o) => o.modelName === name);

describe("source/aliyun-cn（百炼国内站人民币价）", () => {
  it("解析「文本生成」下的北京地域，≥ 60 个模型，全部人民币，来源指向中国站", async () => {
    const offerings = parseAliyunCnHtml(await loadFixture());
    expect(offerings.length).toBeGreaterThanOrEqual(60);
    expect(new Set(offerings.map((o) => o.currency))).toEqual(new Set(["CNY"]));
    for (const offering of offerings) {
      expect(offering.sourceUrl).toBe(ALIYUN_CN_URL);
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
    const names = offerings.map((o) => o.modelName);
    expect(names).not.toContain("deepseek-v4.1-flash");
    expect(new Set(names).size).toBe(names.length);
  });

  it("抽查：与 2026-11-20 人工核对的价格一致", async () => {
    expect(await byName("qwen4-max")).toMatchObject({ unit: "per_1m", input: 10, output: 30 });
    expect(await byName("qwen3.8-max")).toMatchObject({ input: 12, output: 36 });
    expect(await byName("qwen-long")).toMatchObject({ input: 0.5, output: 2 });
    const plus = await byName("qwen3.7-plus");
    expect(plus).toMatchObject({ input: 2, output: 8 });
    expect(plus?.tiers).toEqual([
      { minInputTokens: 0, maxInputTokens: 256000, input: 2, output: 8 },
      { minInputTokens: 256000, maxInputTokens: 1000000, input: 6, output: 24 },
    ]);
    expect(plus?.notes).toContain("限时8折");
  });

  it("注册为 official-cn 平台，优先级高于人工核对的 manual-cn", async () => {
    expect(ALL_SOURCES).toContain(aliyunCnSource);
    expect(aliyunCnSource.platform).toBe("official-cn");
    expect(sourcePriority("aliyun-cn")).toBeGreaterThan(sourcePriority("manual-cn"));
    const html = await loadFixture();
    const ctx = {
      http: createFakeHttp({ [ALIYUN_CN_URL]: html }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect((await aliyunCnSource.fetch(ctx)).length).toBeGreaterThanOrEqual(60);
  });

  it("「仅供免费体验」的模型没有价格，静默跳过，不记 W2003", async () => {
    const warn = vi.fn();
    const logger = { ...silentLogger, warn };
    const offerings = parseAliyunCnHtml(await loadFixture(), logger);
    expect(offerings.map((o) => o.modelName)).not.toContain("qwen-audio-turbo");
    expect(warn).not.toHaveBeenCalled();
  });

  it("页面改版找不到北京地域时报 E2001，并带上 aliyun-cn 的源 ID", () => {
    expect(() => parseAliyunCnHtml("<h2>文本生成-千问</h2><p>改版了</p>")).toThrow(/aliyun-cn/);
  });
});
