import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DataLoadError, formatIssues } from "../src/lib/data-errors";
import {
  DEFAULT_FALLBACK_RATE,
  findRepoRoot,
  loadProviders,
  loadSiteData,
  resolveLoadOptions,
} from "../src/lib/load-data";
import { getSiteModel, resetSiteModel } from "../src/lib/site-data";
import { FIXTURE_DIR, PROVIDERS_FILE, REPO_ROOT, SITE_ROOT, fixtureData } from "./helpers";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "aipb-site-"));
}

describe("load-data", () => {
  afterEach(() => {
    delete process.env["DATA_DIR"];
    resetSiteModel();
  });

  it("读取并校验 fixture 数据", () => {
    const data = fixtureData();
    expect(data.latest?.offerings.length).toBeGreaterThanOrEqual(30);
    expect(
      data.histories.get("deepseek/deepseek-chat")?.series["official:deepseek/deepseek-chat"],
    ).toHaveLength(2);
    expect(data.changeMonths.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(data.fx.latest.provider).toBe("frankfurter");
    expect(data.status?.sources.some((s) => s.status === "failed")).toBe(true);
    expect(data.quarantine.entries).toHaveLength(1);
    expect(data.providers.vendors.some((v) => v.id === "deepseek")).toBe(true);
  });

  it("数据目录为空或不存在时返回空数据和 fallback 汇率", () => {
    const empty = loadSiteData({
      dataDir: join(tempDir(), "missing"),
      providersFile: PROVIDERS_FILE,
      today: "2026-10-18",
    });
    expect(empty.latest).toBeNull();
    expect(empty.histories.size).toBe(0);
    expect(empty.changeMonths).toEqual([]);
    expect(empty.status).toBeNull();
    expect(empty.quarantine.entries).toEqual([]);
    expect(empty.fx.latest).toEqual({
      date: "2026-10-18",
      usdCny: DEFAULT_FALLBACK_RATE,
      provider: "fallback",
    });
  });

  it("字段不合法时给出带文件路径和字段的报错", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "latest.json"),
      JSON.stringify({
        schemaVersion: "1",
        generatedAt: "bad",
        dataDate: "2026-10-18",
        offerings: [],
      }),
    );
    expect(() => loadSiteData({ dataDir: dir, providersFile: PROVIDERS_FILE })).toThrow(
      DataLoadError,
    );
    expect(() => loadSiteData({ dataDir: dir, providersFile: PROVIDERS_FILE })).toThrow(
      /latest\.json[\s\S]*generatedAt/,
    );
  });

  it("JSON 语法错误时报错", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "fx.json"), "{ not json");
    expect(() => loadSiteData({ dataDir: dir, providersFile: PROVIDERS_FILE })).toThrow(
      /JSON 解析失败/,
    );
  });

  it("history 文件不合法时报错", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "history", "openai"), { recursive: true });
    writeFileSync(
      join(dir, "history", "openai", "gpt-5.json"),
      JSON.stringify({ modelSlug: "openai/gpt-5", series: { a: [{}] } }),
    );
    expect(() => loadSiteData({ dataDir: dir, providersFile: PROVIDERS_FILE })).toThrow(
      /gpt-5\.json/,
    );
  });

  it("没有 quarantine.json 时使用 status.json 里的隔离区", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "status.json"), JSON.stringify(fixtureData().status));
    const data = loadSiteData({ dataDir: dir, providersFile: PROVIDERS_FILE });
    expect(data.quarantine.entries).toHaveLength(1);
  });

  it("厂商配置支持 yaml 和 json，找不到时报错", () => {
    expect(loadProviders(PROVIDERS_FILE).platforms.map((p) => p.id)).toContain("official");
    const dir = tempDir();
    const json = join(dir, "providers.json");
    writeFileSync(json, JSON.stringify(fixtureData().providers));
    expect(loadProviders(json).vendors.length).toBe(fixtureData().providers.vendors.length);
    expect(() => loadProviders(join(dir, "nope.yaml"))).toThrow(/找不到厂商配置文件/);
  });

  it("yaml 内容不符合 schema 时给出清晰报错", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "providers.yaml"), "vendors: []\n");
    expect(() => loadProviders(join(dir, "providers.yaml"))).toThrow(/platforms/);
  });

  it("从环境变量解析路径", () => {
    expect(findRepoRoot(SITE_ROOT)).toBe(REPO_ROOT);
    const defaults = resolveLoadOptions({}, SITE_ROOT);
    expect(defaults.dataDir).toBe(join(REPO_ROOT, "data"));
    expect(defaults.providersFile).toBe(PROVIDERS_FILE);
    expect(defaults.fallbackRate).toBe(DEFAULT_FALLBACK_RATE);
    const custom = resolveLoadOptions(
      { DATA_DIR: "tests/fixtures/data", FX_FALLBACK_RATE: "7.3", PROVIDERS_FILE: "x.json" },
      SITE_ROOT,
    );
    expect(custom.dataDir).toBe(FIXTURE_DIR);
    expect(custom.fallbackRate).toBe(7.3);
    expect(custom.providersFile).toBe(join(SITE_ROOT, "x.json"));
    expect(findRepoRoot("/")).toBe("/");
  });

  it("getSiteModel 读取 DATA_DIR 并缓存", () => {
    process.env["DATA_DIR"] = FIXTURE_DIR;
    const first = getSiteModel();
    expect(first.offerings.length).toBeGreaterThan(0);
    expect(getSiteModel()).toBe(first);
  });

  it("错误列表最多显示 10 条", () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ path: ["a", i], message: "bad" }));
    const text = formatIssues(issues);
    expect(text).toContain("a.0: bad");
    expect(text).toContain("另有 2 处错误");
    expect(formatIssues([{ path: [], message: "x" }])).toContain("(根节点)");
  });
});
