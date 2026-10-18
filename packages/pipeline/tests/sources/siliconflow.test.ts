import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  parseSiliconflowHtml,
  SILICONFLOW_URL,
  siliconflowSource,
  splitPriceText,
  toVendorHint,
} from "../../src/sources/siliconflow";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "siliconflow/2026-10-18.html"), "utf8");
const find = async (vendorHint: string, modelName: string) =>
  parseSiliconflowHtml(await loadFixture()).find(
    (o) => o.vendorHint === vendorHint && o.modelName === modelName,
  );

const card = (name: string, subType: string, prices: string, provider = "DeepSeek") => `
  <a><div>
    <p data-framer-name="parameters">${provider}</p><div data-framer-name="sub_type"><p>${subType}</p></div>
    <h3 data-framer-name="model_name">${name}</h3>
    <p data-framer-name="description">Output: lots of text</p>
    <p data-framer-name="currency">Total Context: </p><p data-framer-name="context_length">128K</p>
    ${prices}
  </div></a>`;

describe("source/siliconflow", () => {
  it("只保留 chat 模型，≥ 40 个，去重", async () => {
    const offerings = parseSiliconflowHtml(await loadFixture());
    expect(offerings.length).toBeGreaterThanOrEqual(40);
    const names = offerings.map((o) => o.modelName);
    expect(names.some((n) => /FLUX|embedding|reranker|CosyVoice/i.test(n))).toBe(false);
    expect(new Set(offerings.map((o) => `${o.vendorHint}/${o.modelName}`)).size).toBe(
      offerings.length,
    );
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("抽查 DeepSeek-V4.1-Flash：vendorHint 用研发厂商，美元 / 每百万 token", async () => {
    expect(await find("deepseek-ai", "DeepSeek-V4.1-Flash")).toMatchObject({
      currency: "USD",
      unit: "per_1m",
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
      contextWindow: 1_049_000,
      maxOutput: 393_000,
      sourceUrl: SILICONFLOW_URL,
    });
  });

  it("抽查 GLM-5.3 与 Qwen3-8B（没有缓存价时 cacheRead = null）", async () => {
    expect(await find("zai", "GLM-5.3")).toMatchObject({
      input: 1.4,
      output: 4.4,
      cacheRead: 0.26,
    });
    expect(await find("Qwen", "Qwen3-8B")).toMatchObject({
      input: 0.06,
      output: 0.06,
      cacheRead: null,
      contextWindow: 131_000,
    });
  });

  it("厂商显示名映射到 providers.yaml 的 matchers", () => {
    expect(toVendorHint("Moonshot AI")).toBe("moonshotai");
    expect(toVendorHint("Z.ai")).toBe("zai");
    expect(toVendorHint("MiniMaxAI")).toBe("minimax");
    expect(toVendorHint("Some Lab")).toBe("some-lab");
  });

  it("splitPriceText 按标签切分价格文字", () => {
    expect(
      splitPriceText(
        "Input: $ 0.1 / M Tokens Cached Input: $ 0.01 / M Tokens Output: $ 0.2 / M Tokens",
      ),
    ).toEqual({
      Input: "$ 0.1 / M Tokens",
      "Cached Input": "$ 0.01 / M Tokens",
      Output: "$ 0.2 / M Tokens",
    });
  });

  it("描述文字不干扰价格；价格单位识别不了时跳过并记录 W2003", () => {
    const write = vi.fn();
    const html =
      card(
        "Good",
        "chat",
        `<p>Input: </p><p>$</p><p data-framer-name="input_pricing">1</p><p>/ M Tokens</p><p>Output: </p><p>$</p><p data-framer-name="output_pricing">2</p><p>/ M Tokens</p>`,
      ) +
      card("Bad", "chat", `<p>Input: </p><p>$</p><p data-framer-name="input_pricing">1</p>`) +
      card("Img", "text-to-image", `<p>$0.06/Image</p>`);
    const offerings = parseSiliconflowHtml(html, createLogger({ write }));
    expect(offerings).toEqual([
      expect.objectContaining({
        modelName: "Good",
        vendorHint: "deepseek-ai",
        input: 1,
        output: 2,
        cacheRead: null,
        contextWindow: 128_000,
        maxOutput: null,
      }),
    ]);
    expect(write.mock.calls.join("")).toContain("W2003");
  });

  it("没有模型卡片时抛 E2001", () => {
    expect(() => parseSiliconflowHtml("<html></html>")).toThrow(/E2001/);
  });

  it("fetch 通过 ctx.http 请求入口 URL", async () => {
    const http = createFakeHttp({ [SILICONFLOW_URL]: await loadFixture() });
    const offerings = await siliconflowSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings.length).toBeGreaterThanOrEqual(40);
    expect(siliconflowSource.platform).toBe("siliconflow");
  });
});
