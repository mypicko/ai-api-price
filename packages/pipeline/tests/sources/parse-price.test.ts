import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import {
  detectCurrency,
  detectUnit,
  findColumn,
  findColumns,
  joinNotes,
  parsePriceText,
  parseTokenCount,
  parseTokenRange,
  readHtmlTables,
  resolvePrice,
} from "../../src/sources/parse-price";

describe("parsePriceText", () => {
  it.each([
    ["¥2", { value: 2, currency: "CNY", unit: null }],
    ["￥0.8", { value: 0.8, currency: "CNY", unit: null }],
    ["2元", { value: 2, currency: "CNY", unit: null }],
    ["2 元/百万tokens", { value: 2, currency: "CNY", unit: "per_1m" }],
    ["0.002元/千tokens", { value: 0.002, currency: "CNY", unit: "per_1k" }],
    ["$0.15", { value: 0.15, currency: "USD", unit: null }],
    ["$0.834 / M Tokens", { value: 0.834, currency: "USD", unit: "per_1m" }],
    ["USD 0.113", { value: 0.113, currency: "USD", unit: null }],
    ["0.848美元/百万 Token", { value: 0.848, currency: "USD", unit: "per_1m" }],
    ["1,200 元", { value: 1200, currency: "CNY", unit: null }],
    ["8元 / M", { value: 8, currency: "CNY", unit: "per_1m" }],
  ])("识别 %s", (text, expected) => {
    expect(parsePriceText(text)).toEqual(expected);
  });

  it("免费、限时免费、不计费 都是 0", () => {
    expect(parsePriceText("免费")?.value).toBe(0);
    expect(parsePriceText("限时免费")?.value).toBe(0);
    expect(parsePriceText("不计费")?.value).toBe(0);
    expect(parsePriceText("Free")?.value).toBe(0);
  });

  it("「-」「—」「不支持」和空字符串不是价格", () => {
    for (const text of ["-", "—", "–", "不支持", "", "  ", "N/A", "无"]) {
      expect(parsePriceText(text)).toBeNull();
    }
    expect(parsePriceText("查看详情")).toBeNull();
  });

  it("一个单元格有多个数字时取第一个（原价 / 忙时价）", () => {
    expect(parsePriceText("原价$0.276（限时8折）")).toMatchObject({
      value: 0.276,
      currency: "USD",
    });
    expect(parsePriceText("忙时 $0.283闲时 $0.141")?.value).toBe(0.283);
  });

  it("单元格没有币种/单位时用上下文补齐，单元格自身的信息优先", () => {
    expect(parsePriceText("8", { currency: "CNY", unit: "per_1m" })).toEqual({
      value: 8,
      currency: "CNY",
      unit: "per_1m",
    });
    expect(parsePriceText("$1", { currency: "CNY", unit: "per_1k" })).toEqual({
      value: 1,
      currency: "USD",
      unit: "per_1k",
    });
  });
});

describe("detectCurrency / detectUnit", () => {
  it("同时出现两种币种时不猜", () => {
    expect(detectCurrency("¥1 / $0.14")).toBeNull();
    expect(detectCurrency("1.5")).toBeNull();
  });

  it("识别各种单位写法", () => {
    expect(detectUnit("输入单价（元/百万 Tokens）")).toBe("per_1m");
    expect(detectUnit("输入单价（每百万Token）")).toBe("per_1m");
    expect(detectUnit("1M tokens")).toBe("per_1m");
    expect(detectUnit("定价（单位：元/千tokens）")).toBe("per_1k");
    expect(detectUnit("千tokens")).toBe("per_1k");
    expect(detectUnit("$0.000002 per token")).toBe("per_token");
    expect(detectUnit("2元/万字符")).toBeNull();
    expect(detectUnit("0.1 元/次")).toBeNull();
    expect(detectUnit("缓存存储（元/百万 Tokens/小时）")).toBeNull();
    expect(detectUnit("8")).toBeNull();
  });
});

describe("resolvePrice", () => {
  const ctx = { sourceId: "test", currency: "CNY", unit: "per_1m" } as const;

  it("返回完整价格；不是价格时返回 null", () => {
    expect(resolvePrice("8", ctx)).toEqual({ value: 8, currency: "CNY", unit: "per_1m" });
    expect(resolvePrice("不支持", ctx)).toBeNull();
  });

  it("单位或币种识别不了时抛 W2003", () => {
    expect(() => resolvePrice("8", { sourceId: "test" })).toThrow(PipelineError);
    try {
      resolvePrice("8", { sourceId: "test", currency: "CNY" });
    } catch (error) {
      expect((error as PipelineError).code).toBe("W2003");
    }
  });

  it("按次/按字符计价的单元格抛 W2003", () => {
    expect(() => resolvePrice("0.1 元/次", ctx)).toThrow(/W2003/);
  });
});

describe("parseTokenCount / parseTokenRange", () => {
  it("token 数量", () => {
    expect(parseTokenCount("128K")).toBe(128_000);
    expect(parseTokenCount("1M")).toBe(1_000_000);
    expect(parseTokenCount("1049K")).toBe(1_049_000);
    expect(parseTokenCount("1,048,576 tokens")).toBe(1_048_576);
    expect(parseTokenCount("最大 384K")).toBe(384_000);
    expect(parseTokenCount("50万tokens")).toBe(500_000);
    expect(parseTokenCount("—")).toBeNull();
    expect(parseTokenCount("0")).toBeNull();
  });

  it("各种区间写法", () => {
    expect(parseTokenRange("输入长度 [0, 32K)")).toEqual({ min: 0, max: 32_000 });
    expect(parseTokenRange("[32K, +)")).toEqual({ min: 32_000, max: null });
    expect(parseTokenRange("输入长度 ≥32K")).toEqual({ min: 32_000, max: null });
    expect(parseTokenRange("输入 [32K, 200K)")).toEqual({ min: 32_000, max: 200_000 });
    expect(parseTokenRange("0<Token≤256K")).toEqual({ min: 0, max: 256_000 });
    expect(parseTokenRange("256K<Token≤1M")).toEqual({ min: 256_000, max: 1_000_000 });
    expect(parseTokenRange("32k-128k")).toEqual({ min: 32_000, max: 128_000 });
    expect(parseTokenRange("128-256k")).toEqual({ min: 128_000, max: 256_000 });
    expect(parseTokenRange("0-32k")).toEqual({ min: 0, max: 32_000 });
    expect(parseTokenRange("无阶梯计价")).toBeNull();
  });
});

describe("readHtmlTables / findColumn", () => {
  const html = `
    <table>
      <thead>
        <tr><th rowspan="2">模型<sup>(1)</sup></th><th colspan="2">输出单价（元/百万 Tokens）</th></tr>
        <tr><th>非思考</th><th>思考</th></tr>
      </thead>
      <tbody>
        <tr><td rowspan="2">a<br>b</td><td>1</td><td>2</td></tr>
        <tr><td>3</td><td>4</td></tr>
      </tbody>
    </table>
    <table><tr><td colspan="2">模型</td><td>x</td></tr><tr><td>价格</td><td>输入</td><td>5元</td></tr></table>`;

  it("展开 rowspan / colspan，多级表头用空格拼接，去掉 sup", () => {
    const [first, second] = readHtmlTables(html);
    expect(first?.headers).toEqual([
      "模型",
      "输出单价（元/百万 Tokens） 非思考",
      "输出单价（元/百万 Tokens） 思考",
    ]);
    expect(first?.rows).toEqual([
      ["a b", "1", "2"],
      ["a b", "3", "4"],
    ]);
    expect(second?.headers).toEqual(["模型", "模型", "x"]);
    expect(second?.rows).toEqual([["价格", "输入", "5元"]]);
  });

  it("可以限定在某个范围内读表格", () => {
    const $ = cheerio.load(
      `<section id="a"><table><tr><th>A</th></tr></table></section><table><tr><th>B</th></tr></table>`,
    );
    expect(readHtmlTables($, "#a").map((t) => t.headers)).toEqual([["A"]]);
  });

  it("按表头文字定位列，缺列时 findColumns 返回 null", () => {
    const headers = ["模型名称", "输入单价（元/百万 Tokens）", "输出单价（元/百万 Tokens）"];
    expect(findColumn(headers, /输出单价/)).toBe(2);
    expect(findColumn(headers, /缓存/)).toBe(-1);
    expect(findColumns(headers, { name: /模型/, input: /输入/ })).toEqual({ name: 0, input: 1 });
    expect(findColumns(headers, { name: /模型/, cache: /缓存/ })).toBeNull();
  });
});

describe("joinNotes", () => {
  it("去重、去空并截断到 200 字", () => {
    expect(joinNotes(["a", "", undefined, "a", "b"])).toBe("a；b");
    expect(joinNotes([])).toBeUndefined();
    expect(joinNotes(["x".repeat(300)])).toHaveLength(200);
  });
});
