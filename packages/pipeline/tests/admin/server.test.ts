import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beijingTime } from "../../src/admin/render";
import { startAdminServer, type RunningAdminServer } from "../../src/admin/server";
import { makeOffering } from "../helpers";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
const NOW = new Date("2026-10-31T12:00:00Z");

const TRAFFIC = {
  data: {
    viewer: {
      accounts: [
        {
          daily: [{ count: 321, sum: { visits: 200 }, dimensions: { date: "2026-10-31" } }],
          paths: [{ count: 99, dimensions: { requestPath: "/ai-api-price/compare/" } }],
          referers: [],
          countries: [],
        },
      ],
    },
  },
  errors: null,
};

async function writeData(dir: string): Promise<void> {
  const offerings = [
    makeOffering({ id: "official:openai/gpt-4o", displayName: "GPT-4o" }),
    makeOffering({
      id: "official:openai/raw-model",
      model: "raw-model",
      modelSlug: "openai/raw-model",
      displayName: "<b>raw-model</b>",
    }),
  ];
  const latest = {
    schemaVersion: "1",
    generatedAt: "2026-10-31T12:01:00Z",
    dataDate: "2026-10-31",
    offerings,
  };
  const status = {
    run: {
      id: "9",
      startedAt: "2026-10-31T12:00:00Z",
      finishedAt: "2026-10-31T12:01:10Z",
      durationMs: 70000,
      result: "partial",
    },
    sources: [
      {
        id: "litellm",
        kind: "api",
        status: "ok",
        offeringCount: 238,
        durationMs: 1500,
        errorCode: null,
        errorMessage: null,
        lastSuccessAt: "2026-10-31T12:00:00Z",
        consecutiveFailures: 0,
      },
      {
        id: "moonshot",
        kind: "html",
        status: "failed",
        offeringCount: 0,
        durationMs: 500,
        errorCode: "E2001",
        errorMessage: "找不到价格表",
        lastSuccessAt: "2026-10-23T01:43:49Z",
        consecutiveFailures: 8,
      },
    ],
    quarantine: [
      {
        offeringId: "official:openai/gpt-4o",
        fields: [{ field: "input", old: 2.5, new: 25, pct: 9 }],
        candidate: { input: 25, output: 10, cacheRead: null, cacheWrite: null },
        firstSeenAt: "2026-10-31T12:00:00Z",
        lastSeenAt: "2026-10-31T12:00:00Z",
        confirmations: 1,
      },
    ],
    warnings: [
      {
        code: "W3007",
        sourceId: null,
        offeringId: "official:openai/gpt-4o",
        message: "官方价与 OpenRouter 价差过大：input 50%",
      },
    ],
  };
  const fx = {
    latest: { date: "2026-10-31", usdCny: 7.1, provider: "frankfurter" },
    lastSuccessAt: null,
    history: [],
  };
  const changes = {
    month: "2026-10",
    events: [
      {
        id: "2026-10-31-official:openai/gpt-4o-1",
        type: "price_down",
        offeringId: "official:openai/gpt-4o",
        vendor: "openai",
        modelSlug: "openai/gpt-4o",
        displayName: "GPT-4o",
        platform: "official",
        currency: "USD",
        fields: [],
        confirmedFromQuarantine: false,
        detectedAt: "2026-10-31T12:00:00Z",
      },
    ],
  };
  await mkdir(path.join(dir, "changes"), { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, "latest.json"), JSON.stringify(latest)),
    writeFile(path.join(dir, "status.json"), JSON.stringify(status)),
    writeFile(path.join(dir, "fx.json"), JSON.stringify(fx)),
    writeFile(path.join(dir, "changes", "2026-10.json"), JSON.stringify(changes)),
  ]);
}

function trafficFetch(body: unknown, status = 200) {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls: () => calls };
}

const CF_ENV = { CF_API_TOKEN: "secret-token", CF_ACCOUNT_ID: "acc", CF_SITE_TAG: "site" };

describe("本地后台服务", () => {
  let dataDir: string;
  let server: RunningAdminServer | null = null;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "aipb-admin-"));
    await writeData(dataDir);
  });
  afterEach(async () => {
    await server?.close();
    server = null;
    await rm(dataDir, { recursive: true, force: true });
  });

  const start = async (env: Record<string, string>, fetchImpl?: typeof fetch) => {
    server = await startAdminServer(
      { rootDir: REPO_ROOT, dataDir, env, now: () => NOW, ...(fetchImpl ? { fetchImpl } : {}) },
      0,
    );
    return server;
  };

  it("首页包含六个板块：概览数字、失败的数据源排第一、告警、隔离区、趋势、数据质量", async () => {
    const s = await start({});
    const res = await fetch(s.url);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const id of ["overview", "traffic", "sources", "warnings", "trend", "quality"])
      expect(html).toContain(`id="${id}"`);
    expect(html).toContain("部分失败");
    expect(html.indexOf("moonshot")).toBeLessThan(html.indexOf("litellm"));
    expect(html).toContain("连续 8 次");
    expect(html).toContain("官方价与 OpenRouter 价差过大");
    expect(html).toContain("input +900%");
    // 原始名检查命中，且模型名被转义
    expect(html).toContain("&lt;b&gt;raw-model&lt;/b&gt;");
    expect(html).not.toContain("<b>raw-model</b>");
  });

  it("没配置 Cloudflare 时提示要填哪些变量", async () => {
    const html = await (await fetch((await start({})).url)).text();
    expect(html).toContain("CF_API_TOKEN");
    expect(html).toContain("还没有配置 Cloudflare 统计接口");
  });

  it("配置了 Cloudflare 时显示访问数据，10 分钟内复用缓存，?refresh=1 强制刷新", async () => {
    const cf = trafficFetch(TRAFFIC);
    const s = await start(CF_ENV, cf.impl);
    const html = await (await fetch(s.url)).text();
    expect(html).toContain("321");
    expect(html).toContain("/ai-api-price/compare/");
    expect(html).not.toContain("secret-token");
    await fetch(s.url);
    expect(cf.calls()).toBe(1);
    await fetch(`${s.url}?refresh=1`);
    expect(cf.calls()).toBe(2);
  });

  it("Cloudflare 接口出错时显示错误信息，页面其它部分照常", async () => {
    const cf = trafficFetch({}, 403);
    const html = await (await fetch((await start(CF_ENV, cf.impl)).url)).text();
    expect(html).toContain("获取失败");
    expect(html).toContain("HTTP 403");
    expect(html).toContain('id="sources"');
  });

  it("data/ 是空的也能打开；其它路径返回 404", async () => {
    await rm(dataDir, { recursive: true, force: true });
    await mkdir(dataDir);
    const s = await start({});
    const html = await (await fetch(s.url)).text();
    expect(html).toContain("还没有运行记录");
    expect((await fetch(`${s.url}nope`)).status).toBe(404);
  });

  it("beijingTime：转成北京时间，缺失时显示 —", () => {
    expect(beijingTime("2026-10-31T12:01:59Z")).toBe("2026-10-31 20:01");
    expect(beijingTime(null)).toBe("—");
  });
});
