import { readFile } from "node:fs/promises";
import path from "node:path";
import { RawOfferingSchema } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  MOONSHOT_FETCH_URL,
  MOONSHOT_URL,
  moonshotSource,
  parseDocTables,
  parseMoonshotMarkdown,
} from "../../src/sources/moonshot";
import { createFakeHttp, FIXTURES_DIR, noopBrowser, NOW, ROOT_DIR } from "../helpers";

const loadFixture = (): Promise<string> =>
  readFile(path.join(FIXTURES_DIR, "moonshot/2026-10-18.md"), "utf8");

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

  it("fetch 请求 Markdown 导出地址", async () => {
    const http = createFakeHttp({ [MOONSHOT_FETCH_URL]: await loadFixture() });
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
});
