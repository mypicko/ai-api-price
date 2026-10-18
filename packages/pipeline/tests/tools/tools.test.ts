import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import type { Source } from "../../src/sources/types";
import { serializeJson } from "../../src/steps/persist";
import { parseRunFlags } from "../../src/tools/cli-args";
import { formatQuarantine, loadQuarantine } from "../../src/tools/quarantine-list";
import {
  createRecordingBrowser,
  createRecordingHttp,
  createSnapshotWriter,
  looksLikeJson,
  runSnapshot,
} from "../../src/tools/snapshot";
import { schemaFor, validateDataDir } from "../../src/tools/validate-data";
import { createFakeHttp, makeOffering, noopBrowser, NOW, NOW_ISO } from "../helpers";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "aipb-tools-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cli-args", () => {
  it("解析 --dry-run / --no-notify / --only", () => {
    expect(parseRunFlags([])).toEqual({ dryRun: false, notify: true, only: null });
    expect(parseRunFlags(["--dry-run", "--only", "litellm, openrouter", "--no-notify"])).toEqual({
      dryRun: true,
      notify: false,
      only: ["litellm", "openrouter"],
    });
    expect(parseRunFlags(["--only=deepseek"]).only).toEqual(["deepseek"]);
  });

  it("参数错误时报错", () => {
    expect(() => parseRunFlags(["--only"])).toThrow(/--only/);
    expect(() => parseRunFlags(["--only", "--dry-run"])).toThrow(/--only/);
    expect(() => parseRunFlags(["--force"])).toThrow(/未知参数/);
  });
});

describe("snapshot", () => {
  it("把响应体按 <日期>-<n>.<ext> 保存，编号接着已有文件递增", async () => {
    const target = path.join(dir, "deepseek");
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "2026-10-18-2.html"), "old");
    const writer = createSnapshotWriter(target, "2026-10-18");
    const http = createRecordingHttp(
      createFakeHttp({
        "https://a.example/page": "<html>价格</html>",
        "https://a.example/api": '{"a":1}',
      }),
      writer,
    );
    await expect(http.getText("https://a.example/page")).resolves.toContain("价格");
    await expect(http.getJson("https://a.example/api")).resolves.toEqual({ a: 1 });
    await expect(http.getText("https://a.example/api")).resolves.toBe('{"a":1}');
    expect((await readdir(target)).toSorted()).toEqual([
      "2026-10-18-2.html",
      "2026-10-18-3.html",
      "2026-10-18-4.json",
      "2026-10-18-5.json",
    ]);
    expect(writer.written()).toHaveLength(3);
  });

  it("getJson 遇到非法 JSON 时照样保存并抛 E2001；浏览器渲染结果保存为 html", async () => {
    const writer = createSnapshotWriter(dir, "2026-10-18");
    const http = createRecordingHttp(createFakeHttp({ "https://a.example/x": "<html>" }), writer);
    await expect(http.getJson("https://a.example/x")).rejects.toMatchObject({ code: "E2001" });
    const browser = createRecordingBrowser(
      { render: async () => "<main>ok</main>", close: async () => undefined },
      writer,
    );
    await browser.render("https://a.example/y");
    await browser.close();
    expect(writer.written().map((f) => path.basename(f))).toEqual([
      "2026-10-18-1.json",
      "2026-10-18-2.html",
    ]);
    expect(looksLikeJson("[1]")).toBe(true);
    expect(looksLikeJson("{oops")).toBe(false);
  });

  it("runSnapshot 运行源并保存到 fixtures/<sourceId>/；解析失败也保留快照", async () => {
    const source = (fail: boolean): Source => ({
      id: "demo",
      platform: "official",
      kind: "html",
      timeoutMs: 1000,
      async fetch(ctx) {
        await ctx.http.getText("https://a.example/page");
        if (fail) throw new PipelineError("E2001", "找不到表格");
        return [];
      },
    });
    const ctx = {
      http: createFakeHttp({ "https://a.example/page": "<html></html>" }),
      browser: noopBrowser,
      logger: silentLogger,
      now: NOW,
      rootDir: dir,
    };
    const ok = await runSnapshot({ source: source(false), ctx, fixturesRoot: dir });
    expect(ok.error).toBeNull();
    expect(ok.files.map((f) => path.relative(dir, f))).toEqual(["demo/2026-10-18-1.html"]);
    const failed = await runSnapshot({ source: source(true), ctx, fixturesRoot: dir });
    expect(failed.error?.code).toBe("E2001");
    expect(failed.files).toHaveLength(1);
    expect(await readFile(path.join(dir, "demo/2026-10-18-2.html"), "utf8")).toBe("<html></html>");
  });
});

describe("validate / quarantine:list", () => {
  it("用 schema 校验 data/ 下的全部文件", async () => {
    await mkdir(path.join(dir, "history/openai"), { recursive: true });
    await mkdir(path.join(dir, "changes"), { recursive: true });
    await mkdir(path.join(dir, ".tmp"), { recursive: true });
    await writeFile(path.join(dir, "quarantine.json"), serializeJson({ entries: [] }));
    await writeFile(
      path.join(dir, "latest.json"),
      serializeJson({
        schemaVersion: "1.0.0",
        generatedAt: NOW_ISO,
        dataDate: "2026-10-18",
        offerings: [makeOffering()],
      }),
    );
    await writeFile(
      path.join(dir, "history/openai/gpt-4o.json"),
      serializeJson({ modelSlug: "openai/gpt-4o", series: { x: [{ effectiveDate: "bad" }] } }),
    );
    await writeFile(path.join(dir, "changes/2026-10.json"), "{");
    await writeFile(path.join(dir, "random.json"), "{}");
    await writeFile(path.join(dir, ".tmp/ignored.json"), "{");
    const checks = await validateDataDir(dir);
    expect(checks.map((c) => [c.file, c.ok])).toEqual([
      ["changes/2026-10.json", false],
      ["history/openai/gpt-4o.json", false],
      ["latest.json", true],
      ["quarantine.json", true],
      ["random.json", false],
    ]);
    await expect(validateDataDir(path.join(dir, "missing"))).resolves.toEqual([]);
    expect(schemaFor("changes/2026-10.json")).not.toBeNull();
    expect(schemaFor("history/../x.json")).toBeNull();
    expect(schemaFor("media/latest.json")).not.toBeNull();
    expect(schemaFor("media/quarantine.json")).not.toBeNull();
    expect(schemaFor("media/history/minimax/minimax-h3.json")).not.toBeNull();
    expect(schemaFor("media/changes/2026-10.json")).not.toBeNull();
    expect(schemaFor("media/status.json")).toBeNull();
  });

  it("列出隔离区条目", async () => {
    await expect(loadQuarantine(dir)).resolves.toEqual([]);
    expect(formatQuarantine([])).toBe("隔离区为空\n");
    expect(formatQuarantine([], "视频/图像隔离区")).toBe("视频/图像隔离区为空\n");
    await expect(loadQuarantine(dir, "media")).resolves.toEqual([]);
    const entry = {
      offeringId: "official:alibaba/qwen-max",
      fields: [{ field: "input" as const, old: 20, new: 8, pct: -0.6 }],
      candidate: { input: 8, output: null, cacheRead: null, cacheWrite: null },
      firstSeenAt: NOW_ISO,
      lastSeenAt: NOW_ISO,
      confirmations: 1,
    };
    await writeFile(path.join(dir, "quarantine.json"), serializeJson({ entries: [entry] }));
    const entries = await loadQuarantine(dir);
    expect(formatQuarantine(entries)).toContain(
      "official:alibaba/qwen-max：input 20 → 8（-60%）；确认 1 次",
    );
  });
});
