import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { MOONSHOT_CN_URL, moonshotCnSource, parseMoonshotCnHtml } from "../../src/sources/moonshot";
import { ALL_SOURCES } from "../../src/sources/registry";
import { sourcePriority } from "../../src/steps/normalize";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "moonshot-cn/2026-11-20.html"), "utf8");
const byName = async (name: string) =>
  parseMoonshotCnHtml(await loadFixture()).find((o) => o.modelName === name);

describe("source/moonshot-cn（Kimi 国内站人民币价）", () => {
  it("解析 K3、K2 两张表共 6 个模型，全部人民币、每百万 tokens，来源指向国内站", async () => {
    const offerings = parseMoonshotCnHtml(await loadFixture());
    expect(offerings.map((o) => o.modelName)).toEqual([
      "kimi-k3.1-pro",
      "kimi-k3.1-pro-highspeed",
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    for (const offering of offerings) {
      expect(offering).toMatchObject({
        currency: "CNY",
        unit: "per_1m",
        sourceUrl: MOONSHOT_CN_URL,
      });
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    }
  });

  it("抽查：与 2026-11-20 人工核对的价格一致；1h 缓存写入写进备注", async () => {
    const pro = await byName("kimi-k3.1-pro");
    expect(pro).toMatchObject({ input: 13, output: 68, cacheRead: 1.3, cacheWrite: 13 });
    expect(pro?.notes).toContain("¥26.00");
    expect(await byName("kimi-k3")).toMatchObject({ input: 20, output: 100, cacheRead: 2 });
    expect(await byName("kimi-k2.6")).toMatchObject({ input: 6.5, output: 27, cacheRead: 1.1 });
  });

  it("上下文长度取自每张表上方的「X 系列模型均支持 N tokens 上下文窗口」", async () => {
    expect((await byName("kimi-k3.1-pro"))?.contextWindow).toBe(1048576);
    expect((await byName("kimi-k2.7-code"))?.contextWindow).toBe(262144);
  });

  it("注册为 official-cn 平台，优先级高于人工核对的 manual-cn", async () => {
    expect(ALL_SOURCES).toContain(moonshotCnSource);
    expect(moonshotCnSource.platform).toBe("official-cn");
    expect(sourcePriority("moonshot-cn")).toBeGreaterThan(sourcePriority("manual-cn"));
    const ctx = {
      http: createFakeHttp({ [MOONSHOT_CN_URL]: await loadFixture() }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    };
    expect(await moonshotCnSource.fetch(ctx)).toHaveLength(6);
  });

  it("页面里没有价格表时报 E2001，并带上 moonshot-cn 的源 ID", () => {
    expect(() => parseMoonshotCnHtml("<html>改版了</html>")).toThrow(/moonshot-cn/);
  });
});
