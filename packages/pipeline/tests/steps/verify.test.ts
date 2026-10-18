import type { Offering, Override } from "@aipb/shared";
import { describe, expect, it, vi } from "vitest";
import { silentLogger } from "../../src/core/logger";
import { decidePrice } from "../../src/steps/quarantine";
import type { Candidate, SourceOutcome } from "../../src/steps/types";
import { findSuspects, matchRefetched, verifyApiAnomalies } from "../../src/steps/verify";

const ID = "openrouter:deepseek/deepseek-v4-flash";

function candidate(input: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    id: ID,
    displayName: "DeepSeek V4 Flash",
    currency: "USD",
    input,
    output: 0.3,
    cacheRead: null,
    cacheWrite: null,
    ...extra,
  } as Candidate;
}

function published(input: number, extra: Partial<Offering> = {}): Offering {
  return { ...candidate(input), status: "active", ...extra } as Offering;
}

function outcome(
  candidates: readonly Candidate[],
  extra: Partial<SourceOutcome> = {},
): SourceOutcome {
  return {
    id: "openrouter",
    kind: "api",
    platform: "openrouter",
    state: "ok",
    candidates,
    offeringCount: candidates.length,
    invalidIds: [],
    durationMs: 1,
    error: null,
    warnings: [],
    ...extra,
  };
}

const base = { overrides: new Map<string, Override>(), threshold: 0.8 };

describe("verify：找出需要复核的突变价格", () => {
  it("接口源突变会被复核", () => {
    const suspects = findSuspects({
      ...base,
      outcomes: [outcome([candidate(0.0065)])],
      previous: [published(0.1)],
    });
    expect(suspects.map((s) => [s.sourceId, s.candidate.id])).toEqual([["openrouter", ID]]);
  });

  it("正常幅度变动、网页源、源失败、新模型、已下架、换币种、人工覆盖都不复核", () => {
    const prev = [published(0.1)];
    const crashed = [candidate(0.0065)];
    const none = (input: Parameters<typeof findSuspects>[0]) =>
      expect(findSuspects(input)).toEqual([]);
    none({ ...base, outcomes: [outcome([candidate(0.09)])], previous: prev });
    none({ ...base, outcomes: [outcome(crashed, { kind: "html" })], previous: prev });
    none({ ...base, outcomes: [outcome(crashed, { state: "failed" })], previous: prev });
    none({ ...base, outcomes: [outcome(crashed)], previous: [] });
    none({
      ...base,
      outcomes: [outcome(crashed)],
      previous: [published(0.1, { status: "removed" })],
    });
    none({
      ...base,
      outcomes: [outcome(crashed)],
      previous: [published(0.1, { currency: "CNY" })],
    });
    const approve = { offering: ID, action: "approve", until: "2026-12-31", reason: "x" } as const;
    none({
      ...base,
      overrides: new Map([[ID, approve]]),
      outcomes: [outcome(crashed)],
      previous: prev,
    });
  });

  it("视频/图像线的候选也参与复核", () => {
    const media = {
      state: "ok" as const,
      candidates: [candidate(0.0065)],
      offeringCount: 1,
      invalidIds: [],
    };
    const suspects = findSuspects({
      ...base,
      outcomes: [outcome([], { media } as unknown as Partial<SourceOutcome>)],
      previous: [published(0.1)],
    });
    expect(suspects).toHaveLength(1);
  });
});

describe("verify：比对复核结果", () => {
  const suspects = [{ sourceId: "openrouter", candidate: candidate(0.0065) }];

  it("数值一致才算通过；不一致、没抓到、复核失败都不算", () => {
    expect(matchRefetched(suspects, [outcome([candidate(0.0065)])])).toEqual(new Set([ID]));
    expect(matchRefetched(suspects, [outcome([candidate(0.007)])])).toEqual(new Set());
    expect(matchRefetched(suspects, [outcome([])])).toEqual(new Set());
    expect(matchRefetched(suspects, [outcome([candidate(0.0065)], { state: "failed" })])).toEqual(
      new Set(),
    );
  });

  it("没有突变时不重新请求；有突变时只重跑涉及的源，并给出 W3008", async () => {
    const rerun = vi.fn(async () => [outcome([candidate(0.0065)])]);
    const quiet = await verifyApiAnomalies({
      ...base,
      outcomes: [outcome([candidate(0.1)])],
      previous: [published(0.1)],
      rerun,
      logger: silentLogger,
    });
    expect(quiet.verified.size).toBe(0);
    expect(rerun).not.toHaveBeenCalled();
    const result = await verifyApiAnomalies({
      ...base,
      outcomes: [outcome([candidate(0.0065)])],
      previous: [published(0.1)],
      rerun,
      logger: silentLogger,
    });
    expect(rerun).toHaveBeenCalledWith(new Set(["openrouter"]));
    expect(result.verified).toEqual(new Set([ID]));
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "W3008", sourceId: "openrouter", offeringId: ID }),
    ]);
  });
});

describe("decidePrice：复核一致的突变直接放行", () => {
  const input = {
    offeringId: ID,
    candidate: candidate(0.0065),
    published: published(0.1),
    entry: null,
    override: null,
    threshold: 0.8,
    nowIso: "2026-10-19T00:00:00Z",
  };

  it("verified = true 直接放行并标记已确认；否则进隔离区", () => {
    expect(decidePrice({ ...input, verified: true })).toEqual({
      kind: "accept",
      confirmedFromQuarantine: true,
    });
    expect(decidePrice(input).kind).toBe("hold");
  });
});
