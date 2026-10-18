import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  cleanDisplayName,
  OPENROUTER_URL,
  openrouterSource,
  parseModelId,
  parseOpenRouter,
  parsePrice,
} from "../../src/sources/openrouter";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const FIXTURE = path.join(FIXTURES_DIR, "openrouter/2026-10-18-1.json");
const KNOWN = new Set([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "x-ai",
  "mistralai",
  "z-ai",
  "moonshotai",
  "meta-llama",
  "nvidia",
  "qwen",
]);
const loadFixture = async (): Promise<unknown> => JSON.parse(await readFile(FIXTURE, "utf8"));
const parse = async () =>
  parseOpenRouter(await loadFixture(), {
    isKnownVendor: (v) => KNOWN.has(v),
    logger: silentLogger,
  });

describe("source/openrouter", () => {
  it("只保留已知厂商，跳过负价格（动态路由）", async () => {
    const offerings = await parse();
    expect(offerings).toHaveLength(13);
    expect(offerings.some((o) => o.vendorHint === "openrouter")).toBe(false);
    expect(offerings.some((o) => o.vendorHint.startsWith("~"))).toBe(false);
  });

  it("字符串价格按 per_token 解析，sourceUrl 为模型页", async () => {
    const gpt = (await parse()).find((o) => o.modelName === "gpt-4o");
    expect(gpt).toMatchObject({
      vendorHint: "openai",
      currency: "USD",
      unit: "per_token",
      input: 0.0000025,
      output: 0.00001,
      cacheRead: 0.00000125,
      cacheWrite: null,
      contextWindow: 128000,
      maxOutput: 16384,
      sourceUrl: "https://openrouter.ai/openai/gpt-4o",
    });
    expect(gpt?.modalities).toEqual(expect.arrayContaining(["text"]));
  });

  it("缓存写入价、显示名去掉厂商前缀", async () => {
    const claude = (await parse()).find((o) => o.modelName === "claude-sonnet-4.5");
    expect(claude).toMatchObject({
      input: 0.000003,
      output: 0.000015,
      cacheRead: 3e-7,
      cacheWrite: 0.00000375,
    });
    expect(claude?.displayName).not.toMatch(/^Anthropic:/);
  });

  it(":free / :batch 变体作为独立模型，sourceUrl 去掉 :variant", async () => {
    const offerings = await parse();
    const free = offerings.find((o) => o.modelName === "nemotron-3.5-super-vl-free");
    expect(free).toMatchObject({
      input: 0,
      output: 0,
      sourceUrl: "https://openrouter.ai/nvidia/nemotron-3.5-super-vl",
    });
    expect(offerings.find((o) => o.modelName === "claude-sonnet-5.5-batch")).toBeDefined();
  });

  it("有按时段的 overrides 时在 notes 里标注「分时段计价」", async () => {
    const flash = (await parse()).find((o) => o.modelName === "deepseek-v4.1-flash-1017");
    expect(flash).toMatchObject({ notes: "分时段计价", input: 0.00000015 });
    expect((await parse()).find((o) => o.modelName === "kimi-k2")?.notes).toBeUndefined();
  });

  it("未知厂商在 debug 日志里汇总", async () => {
    const lines: string[] = [];
    parseOpenRouter(await loadFixture(), {
      isKnownVendor: (v) => KNOWN.has(v),
      logger: createLogger({ level: "debug", write: (l) => lines.push(l) }),
    });
    const entry = JSON.parse(lines[0] ?? "{}") as { count?: number; vendors?: string[] };
    expect(entry.count).toBe(3);
    expect(entry.vendors).toEqual(["aion-labs", "xingchen-agi", "~unbiased"]);
  });

  it("工具函数", () => {
    expect(parseModelId("openai/gpt-4o:free")).toEqual({
      vendor: "openai",
      model: "gpt-4o-free",
      baseId: "openai/gpt-4o",
    });
    expect(parseModelId("meta-llama/llama-3/x")).toEqual({
      vendor: "meta-llama",
      model: "llama-3/x",
      baseId: "meta-llama/llama-3/x",
    });
    expect(parsePrice("0.000001")).toBe(0.000001);
    expect(parsePrice(undefined)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(Number.isNaN(parsePrice("abc"))).toBe(true);
    expect(cleanDisplayName("OpenAI: GPT-4o")).toBe("GPT-4o");
    expect(cleanDisplayName("GPT-4o")).toBe("GPT-4o");
    expect(cleanDisplayName(undefined)).toBeUndefined();
  });

  it("非法价格、缺 data 数组时的处理", () => {
    const data = {
      data: [
        { id: "openai/x", pricing: { prompt: "abc", completion: "1" } },
        { id: "openai/y", pricing: {} },
        { id: "bad" },
      ],
    };
    expect(parseOpenRouter(data, { isKnownVendor: () => true, logger: silentLogger })).toEqual([]);
    expect(() => parseOpenRouter({}, { isKnownVendor: () => true, logger: silentLogger })).toThrow(
      /E2001/,
    );
  });

  it("fetch：读取 providers.yaml 过滤厂商；0 条时抛 E2001", async () => {
    const ctx = { browser: noopBrowser, logger: silentLogger, now: NOW, rootDir: ROOT_DIR };
    const http = createFakeHttp({ [OPENROUTER_URL]: await readFile(FIXTURE, "utf8") });
    const offerings = await openrouterSource.fetch({ ...ctx, http });
    expect(offerings.length).toBeGreaterThanOrEqual(12);
    const empty = createFakeHttp({ [OPENROUTER_URL]: '{"data":[]}' });
    await expect(openrouterSource.fetch({ ...ctx, http: empty })).rejects.toMatchObject({
      code: "E2001",
    });
  });
});
