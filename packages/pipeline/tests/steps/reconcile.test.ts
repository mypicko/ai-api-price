import type { Offering, Override, QuarantineEntry } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { offeringContentKey, reconcile, type ReconcileInput } from "../../src/steps/reconcile";
import type { Candidate, SourceOutcome, SourceRunState } from "../../src/steps/types";
import { makeCandidate, makeOffering, NOW_ISO, TODAY } from "../helpers";

function outcome(
  id: string,
  state: SourceRunState,
  candidates: readonly Candidate[] = [],
  invalidIds: string[] = [],
): SourceOutcome {
  return {
    id,
    kind: "api",
    platform: "official",
    state,
    candidates,
    offeringCount: candidates.length,
    invalidIds,
    durationMs: 1,
    error: null,
    warnings: [],
  };
}

function run(overrides: Partial<ReconcileInput>): ReturnType<typeof reconcile> {
  return reconcile({
    previous: [],
    previousDataDate: "2026-10-17",
    outcomes: [],
    quarantine: [],
    overrides: new Map(),
    threshold: 0.8,
    nowIso: NOW_ISO,
    today: TODAY,
    ...overrides,
  });
}

function only(result: ReturnType<typeof reconcile>): Offering {
  const first = result.offerings[0];
  if (!first) throw new Error("expected one offering");
  return first;
}
const ID = "official:openai/gpt-4o";

describe("reconcile", () => {
  it("新模型：firstSeenAt = 今天，fetchedAt/publishedAt = now", () => {
    const result = run({ outcomes: [outcome("litellm", "ok", [makeCandidate()])] });
    expect(result.offerings).toHaveLength(1);
    expect(result.offerings[0]).toMatchObject({
      id: ID,
      status: "active",
      stale: false,
      missingDays: 0,
      isFree: false,
      firstSeenAt: TODAY,
      fetchedAt: NOW_ISO,
      publishedAt: NOW_ISO,
    });
  });

  it("免费模型 isFree = true", () => {
    const result = run({
      outcomes: [outcome("litellm", "ok", [makeCandidate({ input: 0, output: 0 })])],
    });
    expect(result.offerings[0]?.isFree).toBe(true);
  });

  it("内容没变时保留 publishedAt，只更新 fetchedAt", () => {
    const prev = makeOffering();
    const result = run({
      previous: [prev],
      outcomes: [outcome("litellm", "ok", [makeCandidate()])],
    });
    expect(result.offerings[0]).toMatchObject({
      publishedAt: prev.publishedAt,
      fetchedAt: NOW_ISO,
      firstSeenAt: "2026-10-01",
    });
  });

  it("源失败：沿用旧值并标记 stale", () => {
    const prev = makeOffering({
      source: "deepseek",
      vendor: "deepseek",
      model: "deepseek-chat",
      id: "official:deepseek/deepseek-chat",
    });
    const result = run({ previous: [prev], outcomes: [outcome("deepseek", "failed")] });
    expect(result.offerings[0]).toEqual({ ...prev, stale: true });
  });

  it("V5 rejected 的源同样沿用旧值并标记 stale", () => {
    const prev = makeOffering();
    const result = run({ previous: [prev], outcomes: [outcome("litellm", "rejected")] });
    expect(result.offerings[0]?.stale).toBe(true);
  });

  it("没运行的源（--only）：旧数据原样保留，不算失败也不算下架", () => {
    const prev = makeOffering({ stale: false });
    const result = run({ previous: [prev], outcomes: [outcome("openrouter", "ok")] });
    expect(result.offerings[0]).toEqual(prev);
    const fromRemovedSource = makeOffering({ source: "gone-source" });
    expect(run({ previous: [fromRemovedSource] }).offerings[0]).toEqual(fromRemovedSource);
  });

  it("V6：源成功但没抓到 → missing，missingDays 每天 +1，连续 3 天 → removed", () => {
    const day1 = only(run({ previous: [makeOffering()], outcomes: [outcome("litellm", "ok")] }));
    expect(day1).toMatchObject({ status: "missing", missingDays: 1, stale: false, input: 2.5 });
    const day2 = only(
      run({
        previous: [day1],
        previousDataDate: "2026-10-17",
        outcomes: [outcome("litellm", "ok")],
      }),
    );
    expect(day2).toMatchObject({ status: "missing", missingDays: 2 });
    const day3 = only(
      run({
        previous: [day2],
        previousDataDate: "2026-10-17",
        outcomes: [outcome("litellm", "ok")],
      }),
    );
    expect(day3).toMatchObject({ status: "removed", missingDays: 3 });
    const later = only(run({ previous: [day3], outcomes: [outcome("litellm", "ok")] }));
    expect(later).toEqual(day3);
  });

  it("V6：同一天多次运行，missingDays 不重复累加", () => {
    const prev = makeOffering({ status: "missing", missingDays: 1 });
    const result = run({
      previous: [prev],
      previousDataDate: TODAY,
      outcomes: [outcome("litellm", "ok")],
    });
    expect(result.offerings[0]).toMatchObject({ status: "missing", missingDays: 1 });
  });

  it("V6：missing 期间重新抓到 → active，missingDays 清零", () => {
    const prev = makeOffering({ status: "missing", missingDays: 2 });
    const result = run({
      previous: [prev],
      outcomes: [outcome("litellm", "ok", [makeCandidate()])],
    });
    expect(result.offerings[0]).toMatchObject({ status: "active", missingDays: 0 });
  });

  it("已下架的模型再次抓到 → 恢复为 active，保留 firstSeenAt", () => {
    const prev = makeOffering({ status: "removed", missingDays: 3, input: 100 });
    const result = run({
      previous: [prev],
      outcomes: [outcome("litellm", "ok", [makeCandidate()])],
    });
    expect(result.offerings[0]).toMatchObject({
      status: "active",
      missingDays: 0,
      input: 2.5,
      firstSeenAt: "2026-10-01",
    });
    expect(result.quarantine).toEqual([]);
  });

  it("被 V2 丢弃的条目沿用旧值，不计入下架", () => {
    const prev = makeOffering();
    const result = run({ previous: [prev], outcomes: [outcome("litellm", "ok", [], [ID])] });
    expect(result.offerings[0]).toMatchObject({ status: "active", stale: true, missingDays: 0 });
  });

  it("优先级：厂商官网 > litellm；官网源失败时继续沿用官网的旧数据", () => {
    const fromLitellm = makeCandidate({
      id: "official:deepseek/deepseek-chat",
      vendor: "deepseek",
      model: "deepseek-chat",
      input: 0.27,
    });
    const fromSite = makeCandidate({
      ...fromLitellm,
      source: "deepseek",
      currency: "CNY",
      input: 2,
    });
    const both = run({
      outcomes: [outcome("litellm", "ok", [fromLitellm]), outcome("deepseek", "ok", [fromSite])],
    });
    expect(both.offerings[0]).toMatchObject({ source: "deepseek", currency: "CNY", input: 2 });

    const prevSite = makeOffering({ ...fromSite });
    const siteFailed = run({
      previous: [prevSite],
      outcomes: [outcome("litellm", "ok", [fromLitellm]), outcome("deepseek", "failed")],
    });
    expect(siteFailed.offerings[0]).toMatchObject({ source: "deepseek", stale: true, input: 2 });

    const prevLitellm = makeOffering({ ...fromLitellm });
    const takeover = run({
      previous: [prevLitellm],
      outcomes: [outcome("litellm", "skipped"), outcome("deepseek", "ok", [fromSite])],
    });
    expect(takeover.offerings[0]).toMatchObject({ source: "deepseek", currency: "CNY" });
  });

  it("V3：突变进入隔离区，网站继续显示旧值，并给出 W3003", () => {
    const prev = makeOffering({ input: 10 });
    const result = run({
      previous: [prev],
      outcomes: [outcome("litellm", "ok", [makeCandidate({ input: 1, contextWindow: 200000 })])],
    });
    expect(result.offerings[0]).toMatchObject({ input: 10, contextWindow: 200000, stale: false });
    expect(result.quarantine).toHaveLength(1);
    expect(result.newlyQuarantined).toHaveLength(1);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "W3003", offeringId: ID })]);
    expect(result.warnings[0]?.message).toContain("-90%");
  });

  it("V4：隔离中第二次抓到同一值 → 发布新值，标记 confirmed，清除隔离条目", () => {
    const prev = makeOffering({ input: 10 });
    const entry: QuarantineEntry = {
      offeringId: ID,
      fields: [{ field: "input", old: 10, new: 1, pct: -0.9 }],
      candidate: { input: 1, output: 10, cacheRead: null, cacheWrite: null },
      firstSeenAt: "2026-10-17T00:00:00Z",
      lastSeenAt: "2026-10-17T00:00:00Z",
      confirmations: 1,
    };
    const result = run({
      previous: [prev],
      quarantine: [entry],
      outcomes: [outcome("litellm", "ok", [makeCandidate({ input: 1 })])],
    });
    expect(result.offerings[0]?.input).toBe(1);
    expect(result.confirmed.has(ID)).toBe(true);
    expect(result.quarantine).toEqual([]);
    expect(result.newlyQuarantined).toEqual([]);
  });

  it("源没运行时保留隔离条目；Offering 下架后删除隔离条目", () => {
    const entry: QuarantineEntry = {
      offeringId: ID,
      fields: [],
      candidate: { input: 1, output: 10, cacheRead: null, cacheWrite: null },
      firstSeenAt: NOW_ISO,
      lastSeenAt: NOW_ISO,
      confirmations: 1,
    };
    const kept = run({
      previous: [makeOffering()],
      quarantine: [entry],
      outcomes: [outcome("litellm", "failed")],
    });
    expect(kept.quarantine).toEqual([entry]);
    const removed = run({
      previous: [makeOffering({ status: "missing", missingDays: 2 })],
      quarantine: [entry],
      outcomes: [outcome("litellm", "ok")],
    });
    expect(removed.offerings[0]?.status).toBe("removed");
    expect(removed.quarantine).toEqual([]);
  });

  it("V8：block 保留旧值；新模型被 block 时不发布", () => {
    const block: Override = { offering: ID, action: "block", until: "2026-11-01", reason: "x" };
    const prev = makeOffering({ input: 10 });
    const kept = run({
      previous: [prev],
      overrides: new Map([[ID, block]]),
      outcomes: [outcome("litellm", "ok", [makeCandidate({ input: 1 })])],
    });
    expect(kept.offerings[0]).toMatchObject({ input: 10, fetchedAt: NOW_ISO });
    const blockedNew = run({
      overrides: new Map([[ID, block]]),
      outcomes: [outcome("litellm", "ok", [makeCandidate()])],
    });
    expect(blockedNew.offerings).toEqual([]);
  });

  it("V8：pin 钉住价格", () => {
    const pin: Override = {
      offering: ID,
      action: "pin",
      until: "2026-11-01",
      reason: "x",
      price: { output: 8 },
    };
    const result = run({
      overrides: new Map([[ID, pin]]),
      outcomes: [outcome("litellm", "ok", [makeCandidate()])],
    });
    expect(result.offerings[0]).toMatchObject({ input: 2.5, output: 8 });
  });

  it("offeringContentKey 与键顺序无关，忽略 fetchedAt/publishedAt", () => {
    const a = makeOffering();
    const reordered = Object.fromEntries(Object.entries(a).toReversed()) as Offering;
    expect(offeringContentKey(reordered)).toBe(
      offeringContentKey({ ...a, fetchedAt: NOW_ISO, publishedAt: NOW_ISO }),
    );
    expect(offeringContentKey(a)).not.toBe(offeringContentKey({ ...a, input: 3 }));
  });
});
