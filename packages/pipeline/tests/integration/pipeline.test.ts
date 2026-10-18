/**
 * 集成测试：用 mock 源跑完整管线（fetch 全部 mock，禁止真实网络），检查 data/ 输出和 ChangeEvent。
 * 覆盖：主流程、无变化不重写 latest.json、源失败、突变隔离与放行、下架、全部失败、--only、V5、dry-run。
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  HistoryFile,
  LatestFile,
  QuarantineFile,
  RawOffering,
  StatusFile,
} from "@aipb/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import { FRANKFURTER_URL } from "../../src/fx/fx";
import type { DailyReport, Notifier } from "../../src/notify/types";
import type { Source } from "../../src/sources/types";
import { runPipeline, type RunResult } from "../../src/steps/run";
import { createFakeHttp, makeConfig, noopBrowser, ROOT_DIR } from "../helpers";

let root: string;
let dataDir: string;

type Behaviour = readonly RawOffering[] | PipelineError;

function raw(
  model: string,
  input: number,
  output: number,
  extra: Partial<RawOffering> = {},
): RawOffering {
  return {
    vendorHint: "openai",
    modelName: model,
    currency: "USD",
    unit: "per_1m",
    input,
    output,
    contextWindow: 128000,
    sourceUrl: "https://openai.com/api/pricing/",
    ...extra,
  };
}

const orRaw = (model: string, input: number, output: number): RawOffering =>
  raw(model, input, output, { sourceUrl: `https://openrouter.ai/openai/${model}` });

function mockSource(id: string, platform: string, behaviour: Behaviour): Source {
  return {
    id,
    platform,
    kind: "api",
    timeoutMs: 1000,
    async fetch() {
      if (behaviour instanceof PipelineError) throw behaviour;
      return behaviour;
    },
  };
}

const BASE_OFFICIAL = [raw("gpt-4o", 2.5, 10), raw("gpt-4o-mini", 0.15, 0.6), raw("o3", 2, 8)];
const BASE_OPENROUTER = [orRaw("gpt-4o", 2.5, 10)];

interface DayOptions {
  readonly official?: Behaviour;
  readonly openrouter?: Behaviour;
  readonly selected?: ReadonlySet<string> | null;
  readonly dryRun?: boolean;
  readonly stepSummaryPath?: string | null;
}

const sent: DailyReport[] = [];
const notifier: Notifier = {
  id: "feishu",
  isConfigured: () => true,
  send: async (r) => void sent.push(r),
};

async function runDay(day: number, options: DayOptions = {}): Promise<RunResult> {
  const now = new Date(Date.UTC(2026, 9, 17 + day, 1, 0, 0));
  return runPipeline({
    rootDir: root,
    dataDir,
    sources: [
      mockSource("litellm", "official", options.official ?? BASE_OFFICIAL),
      mockSource("openrouter", "openrouter", options.openrouter ?? BASE_OPENROUTER),
    ],
    selected: options.selected ?? null,
    config: makeConfig({ stepSummaryPath: options.stepSummaryPath ?? null }),
    configWarnings: [],
    http: createFakeHttp({
      [FRANKFURTER_URL]: JSON.stringify({ date: "2026-10-17", rates: { CNY: 7.1 } }),
    }),
    browser: noopBrowser,
    logger: silentLogger,
    clock: () => now,
    dryRun: options.dryRun ?? false,
    notify: true,
    notifiers: [notifier],
  });
}

async function readData<T>(relative: string): Promise<T> {
  return JSON.parse(await readFile(path.join(dataDir, relative), "utf8")) as T;
}

const exists = (relative: string): Promise<boolean> =>
  stat(path.join(dataDir, relative)).then(
    () => true,
    () => false,
  );

const offering = (latest: LatestFile, id: string) => latest.offerings.find((o) => o.id === id);
const GPT = "official:openai/gpt-4o";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "aipb-int-"));
  dataDir = path.join(root, "data");
  await mkdir(path.join(root, "config"), { recursive: true });
  await copyFile(
    path.join(ROOT_DIR, "config/providers.yaml"),
    path.join(root, "config/providers.yaml"),
  );
  sent.length = 0;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("集成：完整管线", () => {
  it("第一次运行：写出全部文件，只建立基线，不生成 new_model 事件", async () => {
    const summaryFile = path.join(root, "summary.md");
    const result = await runDay(1, { stepSummaryPath: summaryFile });
    expect(result.exitCode).toBe(0);
    expect(result.status.run.result).toBe("success");
    expect(result.written).toEqual([
      "fx.json",
      "history/openai/gpt-4o-mini.json",
      "history/openai/gpt-4o.json",
      "history/openai/o3.json",
      "latest.json",
      "quarantine.json",
      "status.json",
    ]);
    const latest = await readData<LatestFile>("latest.json");
    expect(latest.offerings.map((o) => o.id)).toEqual([
      "official:openai/gpt-4o",
      "official:openai/gpt-4o-mini",
      "official:openai/o3",
      "openrouter:openai/gpt-4o",
    ]);
    expect(latest.dataDate).toBe("2026-10-18");
    expect(result.events).toHaveLength(0);
    expect(await exists("changes/2026-10.json")).toBe(false);
    const history = await readData<HistoryFile>("history/openai/gpt-4o.json");
    expect(Object.keys(history.series)).toEqual([GPT, "openrouter:openai/gpt-4o"]);
    expect(sent).toHaveLength(0);
    expect(await readFile(summaryFile, "utf8")).toContain("AI API 价格日报 · 2026-10-18");
    expect(await exists(".tmp")).toBe(false);
  });

  it("基线之后新出现的模型生成 new_model 事件并推送", async () => {
    await runDay(1);
    const result = await runDay(2, { official: [...BASE_OFFICIAL, raw("o4", 1, 4)] });
    expect(result.events.map((e) => [e.type, e.offeringId])).toEqual([
      ["new_model", "official:openai/o4"],
    ]);
    expect(sent.at(-1)?.changes).toHaveLength(1);
  });

  it("没有变化时不重写 latest.json，不生成事件，也不推送", async () => {
    await runDay(1);
    const before = await readFile(path.join(dataDir, "latest.json"), "utf8");
    sent.length = 0;
    const result = await runDay(2);
    expect(result.latestUnchanged).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.written).not.toContain("latest.json");
    expect(result.written).not.toContain("changes/2026-10.json");
    expect(await readFile(path.join(dataDir, "latest.json"), "utf8")).toBe(before);
    expect(sent).toEqual([]);
  });

  it("小幅降价：生成 price_down 事件并追加历史点", async () => {
    await runDay(1);
    const result = await runDay(2, { official: [raw("gpt-4o", 2, 10), ...BASE_OFFICIAL.slice(1)] });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "price_down", offeringId: GPT, id: `2026-10-19-${GPT}-1` }),
    ]);
    const history = await readData<HistoryFile>("history/openai/gpt-4o.json");
    expect(history.series[GPT]?.map((p) => [p.effectiveDate, p.input])).toEqual([
      ["2026-10-18", 2.5],
      ["2026-10-19", 2],
    ]);
    expect(offering(await readData<LatestFile>("latest.json"), GPT)?.input).toBe(2);
  });

  it("源失败：沿用旧数据并标记 stale，部分失败退出码仍为 0", async () => {
    await runDay(1);
    const result = await runDay(2, {
      official: new PipelineError("E1001", "HTTP 503", { sourceId: "litellm" }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.status.run.result).toBe("partial");
    const status = await readData<StatusFile>("status.json");
    expect(status.sources.find((s) => s.id === "litellm")).toMatchObject({
      status: "failed",
      errorCode: "E1001",
      consecutiveFailures: 1,
    });
    expect(status.warnings.some((w) => w.code === "E1001" && w.sourceId === "litellm")).toBe(true);
    const latest = await readData<LatestFile>("latest.json");
    expect(offering(latest, GPT)).toMatchObject({ stale: true, status: "active", input: 2.5 });
    expect(offering(latest, "openrouter:openai/gpt-4o")?.stale).toBe(false);
    expect(sent.at(-1)?.sources.map((s) => [s.id, s.status])).toEqual([
      ["litellm", "failed"],
      ["openrouter", "ok"],
    ]);
  });

  it("连续失败 ≥ 3 次给出 E1005", async () => {
    await runDay(1);
    const fail = new PipelineError("E1002", "超时");
    await runDay(2, { official: fail });
    await runDay(3, { official: fail });
    const result = await runDay(4, { official: fail });
    expect(result.status.warnings.some((w) => w.code === "E1005" && w.sourceId === "litellm")).toBe(
      true,
    );
  });

  it("突变：进入隔离区并保留旧值；第二次抓到同一值后放行（已确认）", async () => {
    await runDay(1);
    const crashed = [raw("gpt-4o", 0.25, 10), ...BASE_OFFICIAL.slice(1)];
    const day2 = await runDay(2, { official: crashed });
    expect(day2.events).toEqual([]);
    expect(offering(await readData<LatestFile>("latest.json"), GPT)?.input).toBe(2.5);
    const quarantine = await readData<QuarantineFile>("quarantine.json");
    expect(quarantine.entries).toEqual([
      expect.objectContaining({
        offeringId: GPT,
        confirmations: 1,
        candidate: expect.objectContaining({ input: 0.25 }),
      }),
    ]);
    expect(day2.status.warnings.some((w) => w.code === "W3003")).toBe(true);
    expect(sent.at(-1)?.quarantined).toHaveLength(1);

    const day3 = await runDay(3, { official: crashed });
    expect(day3.events).toEqual([
      expect.objectContaining({ type: "price_down", confirmedFromQuarantine: true }),
    ]);
    expect(offering(await readData<LatestFile>("latest.json"), GPT)?.input).toBe(0.25);
    expect((await readData<QuarantineFile>("quarantine.json")).entries).toEqual([]);
  });

  it("下架：连续 3 天没抓到才判定 removed，再次出现时 restored", async () => {
    await runDay(1);
    const withoutO3 = BASE_OFFICIAL.slice(0, 2);
    await runDay(2, { official: withoutO3 });
    expect(offering(await readData<LatestFile>("latest.json"), "official:openai/o3")).toMatchObject(
      { status: "missing", missingDays: 1 },
    );
    await runDay(3, { official: withoutO3 });
    const day4 = await runDay(4, { official: withoutO3 });
    expect(day4.events).toEqual([
      expect.objectContaining({ type: "removed", offeringId: "official:openai/o3" }),
    ]);
    expect(offering(await readData<LatestFile>("latest.json"), "official:openai/o3")?.status).toBe(
      "removed",
    );
    const day5 = await runDay(5);
    expect(day5.events).toEqual([
      expect.objectContaining({ type: "restored", offeringId: "official:openai/o3" }),
    ]);
  });

  it("全部源失败：退出码 1", async () => {
    const fail = new PipelineError("E1001", "down");
    const result = await runDay(1, { official: fail, openrouter: fail });
    expect(result.exitCode).toBe(1);
    expect(result.status.run.result).toBe("failed");
  });

  it("--only：其他源当作没运行，不计失败、不触发下架", async () => {
    await runDay(1);
    for (const day of [2, 3, 4]) {
      const result = await runDay(day, { selected: new Set(["openrouter"]), official: [] });
      expect(result.status.run.result).toBe("success");
    }
    const latest = await readData<LatestFile>("latest.json");
    expect(offering(latest, "official:openai/o3")).toMatchObject({
      status: "active",
      stale: false,
    });
    const status = await readData<StatusFile>("status.json");
    expect(status.sources.find((s) => s.id === "litellm")?.consecutiveFailures).toBe(0);
  });

  it("V5：模型数骤降时整个源被拒绝，沿用旧数据", async () => {
    await runDay(1);
    const result = await runDay(2, { official: [raw("gpt-4o", 2.5, 10)] });
    expect(result.status.sources.find((s) => s.id === "litellm")).toMatchObject({
      status: "rejected",
      errorCode: "E3004",
    });
    const latest = await readData<LatestFile>("latest.json");
    expect(offering(latest, "official:openai/o3")).toMatchObject({ status: "active", stale: true });
  });

  it("V1/V2/S8：不合法的条目被丢弃并记录警告", async () => {
    const official = [
      ...BASE_OFFICIAL,
      raw("too-expensive", 5000, 1),
      raw("bad-url", 1, 1, { sourceUrl: "https://evil.example.com/x" }),
      { ...raw("negative", -1, 1) },
      raw("unknown", 1, 1, { vendorHint: "nobody" }),
    ];
    const result = await runDay(1, { official });
    const codes = result.status.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["E3001", "E3002", "E3005", "W2003"]));
    expect(result.offerings.map((o) => o.model)).not.toContain("too-expensive");
    expect(result.status.sources.find((s) => s.id === "litellm")?.offeringCount).toBe(3);
  });

  it("dry-run：不写 data/、不推送", async () => {
    const result = await runDay(1, { dryRun: true });
    expect(result.written).toEqual([]);
    expect(await exists("latest.json")).toBe(false);
    expect(sent).toEqual([]);
    expect(result.summary).toContain("DRY RUN");
  });
});
