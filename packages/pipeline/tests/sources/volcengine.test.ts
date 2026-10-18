import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  DEFAULT_TEMPLATE_CODE,
  findTemplateCode,
  GET_TABLE_URL,
  listTemplateUrl,
  NAVIGATION_URL,
  parseVolcengine,
  VOLCENGINE_URL,
  volcengineSource,
} from "../../src/sources/volcengine";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

interface Fixture {
  readonly navigation: unknown;
  readonly listTemplate: unknown;
  readonly getTable: unknown;
}
const loadFixture = async (): Promise<Fixture> =>
  JSON.parse(
    await readFile(path.join(FIXTURES_DIR, "volcengine/2026-10-18.json"), "utf8"),
  ) as Fixture;
const parse = async () => {
  const f = await loadFixture();
  return parseVolcengine(f.listTemplate, f.getTable);
};

/** 构造一个最小的 ListTemplate + GetTable 响应 */
function minimal(
  items: readonly { code: string; name?: string; unit?: string }[],
  prices: Record<string, string>,
  title = "定价（单位：元/千tokens）",
) {
  const template = {
    Fields: {
      T: {
        Type: "Table",
        Columns: [
          {
            Title: "模型",
            Type: "chargeItem",
            Data: items.map((i) => ({
              ConfigurationName: i.name ?? "Doubao-X",
              ChargeItemCode: i.code,
              Unit: i.unit ?? "千tokens",
            })),
          },
          { Title: title, Type: "price" },
        ],
      },
      Other: { Type: "RichText" },
    },
  };
  return {
    listTemplate: { Result: { List: [{ Template: JSON.stringify(template) }] } },
    getTable: {
      Result: {
        TableList: [
          {
            Rows: Object.entries(prices).map(([code, price]) => ({
              ChargeItemCode: code,
              PriceInfoList: [{ Price: price }],
            })),
          },
        ],
      },
    },
  };
}

describe("source/volcengine", () => {
  it("从导航里找到火山方舟价格模板", async () => {
    expect(findTemplateCode((await loadFixture()).navigation)).toBe(DEFAULT_TEMPLATE_CODE);
    expect(findTemplateCode({ Result: { Navigation: "not json" } })).toBeNull();
    expect(findTemplateCode({})).toBeNull();
    expect(findTemplateCode({ Result: { Navigation: "[]" } })).toBeNull();
  });

  it("解析出 ≥ 6 个 Doubao 文本模型，排除批量推理、音频、向量、视频图像", async () => {
    const offerings = await parse();
    expect(offerings.length).toBeGreaterThanOrEqual(6);
    const names = offerings.map((o) => o.modelName);
    expect(names).toEqual(
      expect.arrayContaining([
        "doubao-seed-2.1-pro",
        "doubao-seed-2.0-pro",
        "doubao-seed-2.0-lite",
      ]),
    );
    expect(names.some((n) => /embedding|seedance|seedream/.test(n))).toBe(false);
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("抽查 Doubao-Seed-2.1-pro：元/千tokens 原始单位", async () => {
    expect((await parse()).find((o) => o.modelName === "doubao-seed-2.1-pro")).toMatchObject({
      vendorHint: "bytedance",
      displayName: "Doubao-Seed-2.1-pro",
      currency: "CNY",
      unit: "per_1k",
      input: 0.006,
      output: 0.03,
      cacheRead: 0.0012,
      sourceUrl: VOLCENGINE_URL,
    });
  });

  it("抽查 Doubao-Seed-2.0-pro / 2.0-mini：按 32k/128k/256k 分 3 档（在线推理价，不是批量）", async () => {
    const offerings = await parse();
    const pro = offerings.find((o) => o.modelName === "doubao-seed-2.0-pro");
    expect(pro).toMatchObject({
      input: 0.0032,
      output: 0.016,
      cacheRead: 0.00064,
      contextWindow: 256_000,
    });
    expect(pro?.tiers).toEqual([
      {
        minInputTokens: 0,
        maxInputTokens: 32_000,
        input: 0.0032,
        output: 0.016,
        cacheRead: 0.00064,
      },
      {
        minInputTokens: 32_000,
        maxInputTokens: 128_000,
        input: 0.0048,
        output: 0.024,
        cacheRead: 0.00096,
      },
      {
        minInputTokens: 128_000,
        maxInputTokens: 256_000,
        input: 0.0096,
        output: 0.048,
        cacheRead: 0.00192,
      },
    ]);
    const mini = offerings.find((o) => o.modelName === "doubao-seed-2.0-mini");
    expect(mini).toMatchObject({ input: 0.0002, output: 0.002, cacheRead: 0.00004 });
  });

  it("缓存命中不分档时套用到每一档", async () => {
    const character = (await parse()).find((o) => o.modelName === "doubao-seed-character");
    expect(character?.tiers?.map((t) => t.cacheRead)).toEqual([0.00016, 0.00016]);
  });

  it("币种识别不了时跳过并记录 W2003；全都无效时抛 E2001", () => {
    const write = vi.fn();
    const { listTemplate, getTable } = minimal(
      [{ code: "Doubao_X_infer_input_cn" }],
      { Doubao_X_infer_input_cn: "1" },
      "定价",
    );
    expect(() => parseVolcengine(listTemplate, getTable, createLogger({ write }))).toThrow(/E2001/);
    expect(write.mock.calls.join("")).toContain("W2003");
  });

  it("响应结构变化时抛错", () => {
    expect(() => parseVolcengine({}, {})).toThrow(/E2001/);
  });

  it("只有输出价的模型也保留；价格缺失的计费项忽略", () => {
    const { listTemplate, getTable } = minimal(
      [
        { code: "Doubao_Y_infer_output_cn" },
        { code: "Doubao_Y_infer_input_cn" },
        { code: "Doubao_Y_unknown_cn" },
      ],
      { Doubao_Y_infer_output_cn: "0.5", Doubao_Y_unknown_cn: "9" },
    );
    expect(parseVolcengine(listTemplate, getTable)).toEqual([
      expect.objectContaining({
        modelName: "doubao-x",
        input: null,
        output: 0.5,
        cacheRead: null,
        contextWindow: null,
      }),
    ]);
  });

  it("fetch：导航 → ListTemplate → GetTable", async () => {
    const f = await loadFixture();
    const http = createFakeHttp(
      { [listTemplateUrl(DEFAULT_TEMPLATE_CODE)]: JSON.stringify(f.listTemplate) },
      (url, body) => {
        if (url === NAVIGATION_URL) return { status: 200, text: JSON.stringify(f.navigation) };
        if (
          url === GET_TABLE_URL &&
          (body as { TemplateCode: string }).TemplateCode === DEFAULT_TEMPLATE_CODE
        ) {
          return { status: 200, text: JSON.stringify(f.getTable) };
        }
        return { status: 404, text: "" };
      },
    );
    const offerings = await volcengineSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings.length).toBeGreaterThanOrEqual(6);
    expect(http.requests.map((r) => r.method)).toEqual(["POST", "GET", "POST"]);
  });

  it("导航失败或找不到模板时退回默认 TemplateCode；GetTable 非 2xx 抛 E1001，非 JSON 抛 E2001", async () => {
    const f = await loadFixture();
    const routes = { [listTemplateUrl(DEFAULT_TEMPLATE_CODE)]: JSON.stringify(f.listTemplate) };
    const ctx = (post: (url: string) => { status: number; text: string }) => ({
      http: createFakeHttp(routes, post),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    const ok = (url: string) =>
      url === NAVIGATION_URL
        ? { status: 500, text: "" }
        : { status: 200, text: JSON.stringify(f.getTable) };
    expect((await volcengineSource.fetch(ctx(ok))).length).toBeGreaterThanOrEqual(6);
    const emptyNav = (url: string) =>
      url === NAVIGATION_URL
        ? { status: 200, text: '{"Result":{"Navigation":"[]"}}' }
        : { status: 200, text: JSON.stringify(f.getTable) };
    expect((await volcengineSource.fetch(ctx(emptyNav))).length).toBeGreaterThanOrEqual(6);
    await expect(volcengineSource.fetch(ctx(() => ({ status: 503, text: "" })))).rejects.toThrow(
      /E1001/,
    );
    await expect(
      volcengineSource.fetch(ctx(() => ({ status: 200, text: "<html>" }))),
    ).rejects.toBeInstanceOf(PipelineError);
  });
});
