import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  MOONSHOT_FETCH_URL,
  MOONSHOT_MARKDOWN_URL,
  MOONSHOT_URL,
  moonshotSource,
  parseCompiledDocTables,
  parseDocTables,
  parseMoonshotHtml,
  parseMoonshotMarkdown,
} from "../../src/sources/moonshot";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "moonshot/2026-10-18.md"), "utf8");
/** 2026-10-20 起 .md 导出的价格表是空的，价格只在 HTML 内嵌的已编译 MDX 里 */
const loadHtmlFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "moonshot/2026-10-23.html"), "utf8");

describe("source/moonshot", () => {
  it("从 DocTable 组件解析出 4 个模型", async () => {
    const offerings = parseMoonshotMarkdown(await loadFixture());
    expect(offerings.map((o) => o.modelName)).toEqual([
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
  });

  it("抽查 kimi-k3：缓存写入 5min 填 cacheWrite，1h 写进 notes", async () => {
    const [k3] = parseMoonshotMarkdown(await loadFixture());
    expect(k3).toMatchObject({
      vendorHint: "moonshot",
      currency: "USD",
      unit: "per_1m",
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3,
      contextWindow: 1_048_576,
      sourceUrl: MOONSHOT_URL,
    });
    expect(k3?.notes).toContain("$6.00");
  });

  it("抽查 kimi-k2.6 与 kimi-k2.7-code：缓存命中 / 未命中两列", async () => {
    const offerings = parseMoonshotMarkdown(await loadFixture());
    expect(offerings.find((o) => o.modelName === "kimi-k2.6")).toMatchObject({
      input: 0.95,
      output: 4,
      cacheRead: 0.16,
      contextWindow: 262_144,
    });
    const code = offerings.find((o) => o.modelName === "kimi-k2.7-code");
    expect(code).toMatchObject({ input: 0.95, output: 4, cacheRead: 0.19 });
    expect(code?.cacheWrite).toBeUndefined();
    expect(code?.notes).toBeUndefined();
  });

  it("支持中文表头和人民币价格", () => {
    const md = `<DocTable
  columns={[
{ title: "模型" },
{ title: "计费单位" },
{ title: "输入价格（缓存命中）" },
{ title: "输入价格（缓存未命中）" },
{ title: "输出价格" },
{ title: "上下文长度" },
]}
  rows={[
["kimi-k2.6", "1M tokens", <>{"¥"}1.10</>, <>{"¥"}6.50</>, <>{"¥"}27.00</>, "262,144 tokens"],
["", "1M tokens", "-", "-", "-", ""],
]}
/>`;
    expect(parseDocTables(md)[0]?.headers).toHaveLength(6);
    expect(parseMoonshotMarkdown(md)).toEqual([
      expect.objectContaining({
        modelName: "kimi-k2.6",
        currency: "CNY",
        unit: "per_1m",
        input: 6.5,
        cacheRead: 1.1,
        output: 27,
      }),
    ]);
  });

  it("单位识别不了的行跳过并记录 W2003；没有价格表时抛 E2001", () => {
    const write = vi.fn();
    const md = `<DocTable
  columns={[{ title: "Model" }, { title: "Unit" }, { title: "Input Price" }, { title: "Output Price" }]}
  rows={[
["a", "1M tokens", "$1", "$2"],
["b", "per image", "$1", "$2"],
["c", "1M tokens", "-", "-"],
]}
/>`;
    expect(parseMoonshotMarkdown(md, createLogger({ write })).map((o) => o.modelName)).toEqual([
      "a",
    ]);
    expect(write.mock.calls.join("")).toContain("W2003");
    expect(() => parseMoonshotMarkdown("# 维护中")).toThrow(/E2001/);
  });

  it("HTML（已编译 MDX）：解析出 4 个模型，结果与旧的 Markdown 格式一致", async () => {
    const html = await loadHtmlFixture();
    const tables = parseCompiledDocTables(html);
    expect(tables.map((t) => t.headers[0])).toEqual(["Model", "Model"]);
    const offerings = parseMoonshotHtml(html);
    expect(offerings.map((o) => o.modelName)).toEqual([
      "kimi-k3",
      "kimi-k2.7-code",
      "kimi-k2.7-code-highspeed",
      "kimi-k2.6",
    ]);
    expect(offerings[0]).toMatchObject({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 });
    expect(offerings[3]).toMatchObject({ input: 0.95, output: 4, cacheRead: 0.16 });
    for (const offering of offerings)
      expect(RawOfferingSchema.safeParse(offering).success).toBe(true);
    expect(() => parseMoonshotHtml("<html>维护中</html>")).toThrow(/E2001/);
  });

  it("已编译 MDX：单元格里的逗号、括号和转义反引号不影响切分", () => {
    const html =
      "x DocTable,{columns:[{title:`Model`},{title:`Input Price`},{title:`Output Price`}]," +
      "rows:[[`a, (b) \\` [c]`,_jsxs(_Fragment,{children:[`$`,`1.50`]}),`$2`]]} y";
    expect(parseCompiledDocTables(html)).toEqual([
      {
        headers: ["Model", "Input Price", "Output Price"],
        rows: [["a, (b) \\` [c]", "$1.50", "$2"]],
      },
    ]);
  });

  it("fetch 先请求 HTML 页面", async () => {
    const http = createFakeHttp({ [MOONSHOT_FETCH_URL]: await loadHtmlFixture() });
    const offerings = await moonshotSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings).toHaveLength(4);
    expect(http.requests.map((r) => r.url)).toEqual([MOONSHOT_FETCH_URL]);
  });

  it("HTML 里没有价格表时退回 .md 导出", async () => {
    const http = createFakeHttp({
      [MOONSHOT_FETCH_URL]: "<html>改版了</html>",
      [MOONSHOT_MARKDOWN_URL]: await loadFixture(),
    });
    const offerings = await moonshotSource.fetch({
      http,
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: ROOT_DIR,
    });
    expect(offerings).toHaveLength(4);
    expect(http.requests.map((r) => r.url)).toEqual([MOONSHOT_FETCH_URL, MOONSHOT_MARKDOWN_URL]);
  });
});
