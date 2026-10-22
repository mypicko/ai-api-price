import { describe, expect, it } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { NOVITA_URL, novitaSource, parseNovita } from "../../src/sources/novita";
import { createFakeHttp, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const price = (v: string | null) => ({ price_per_m: 0, price_per_m_decimal: v });
const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  display_name: "DeepSeek V4.1 Flash",
  model_type: "chat",
  status: 1,
  is_tiered_billing: false,
  context_size: 1048576,
  max_output_tokens: 393216,
  pricing: { prompt: price("0.3"), completion: price("1.2"), input_cache_read: price("0.006") },
  ...extra,
});

describe("novita", () => {
  it("按百万 tokens 的十进制价格解析，识别厂商", async () => {
    const http = createFakeHttp({
      [NOVITA_URL]: JSON.stringify({ data: [model("deepseek/deepseek-v4.1-flash-1017")] }),
    });
    const raws = await novitaSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(raws[0]).toMatchObject({
      vendorHint: "deepseek",
      modelName: "deepseek-v4.1-flash-1017",
      displayName: "DeepSeek V4.1 Flash",
      platform: "novita",
      unit: "per_1m",
      input: 0.3,
      output: 1.2,
      cacheRead: 0.006,
      contextWindow: 1048576,
      maxOutput: 393216,
    });
  });

  it("跳过非对话、停用、分档计价、认不出厂商、价格缺失的模型", () => {
    const raws = parseNovita({
      data: [
        model("deepseek/a"),
        model("deepseek/embed", { model_type: "embedding" }),
        model("deepseek/off", { status: 0 }),
        model("deepseek/tiered", { is_tiered_billing: true }),
        model("someone/x"),
        model("deepseek/noprice", { pricing: { prompt: price(null), completion: price("") } }),
        model("deepseek/bad", { pricing: { prompt: price("-1"), completion: price("abc") } }),
      ],
    });
    expect(raws.map((r) => r.modelName)).toEqual(["a"]);
  });

  it("格式不对时报错", () => {
    expect(() => parseNovita([1, 2])).toThrow();
  });
});
