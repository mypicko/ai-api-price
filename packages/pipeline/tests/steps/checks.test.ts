import type { SourceResult } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { crossCheck } from "../../src/steps/cross-check";
import { daysBetween, monthOf, shanghaiDate, toIsoSeconds } from "../../src/steps/dates";
import {
  buildSourceResults,
  checkManualFreshness,
  MANUAL_STALE_CODE,
} from "../../src/steps/source-health";
import type { SourceOutcome } from "../../src/steps/types";
import { makeOffering, NOW, NOW_ISO } from "../helpers";

describe("V7 交叉核对", () => {
  const official = makeOffering({
    id: "official:anthropic/claude-sonnet-4-5",
    vendor: "anthropic",
    model: "claude-sonnet-4-5",
    modelSlug: "anthropic/claude-sonnet-4-5",
    input: 3,
    output: 15,
  });
  const or = (input: number, output: number) =>
    makeOffering({
      id: "openrouter:anthropic/claude-sonnet-4.5",
      platform: "openrouter",
      vendor: "anthropic",
      model: "claude-sonnet-4.5",
      modelSlug: "anthropic/claude-sonnet-4.5",
      input,
      output,
    });

  it("价差 > 30% 时记 W3007（模型 ID 中 . 和 - 视为等价）", () => {
    const warnings = crossCheck([official, or(4.5, 15)], 7);
    expect(warnings).toEqual([expect.objectContaining({ code: "W3007", offeringId: official.id })]);
    expect(warnings[0]?.message).toContain("input 50%");
  });

  it("价差在 30% 以内、没有对应平台报价、已下架时不记录", () => {
    expect(crossCheck([official, or(3.5, 16)], 7)).toEqual([]);
    expect(crossCheck([official], 7)).toEqual([]);
    expect(crossCheck([official, { ...or(9, 99), status: "removed" }], 7)).toEqual([]);
  });

  it("不同币种先换算成 USD 再比较", () => {
    const cny = { ...official, currency: "CNY" as const, input: 21, output: 105 };
    expect(crossCheck([cny, or(3, 15)], 7)).toEqual([]);
    expect(crossCheck([cny, or(3, 15)], 3.5)).toHaveLength(1);
  });
});

function outcome(
  id: string,
  state: SourceOutcome["state"],
  error: PipelineError | null = null,
): SourceOutcome {
  return {
    id,
    kind: "api",
    platform: "official",
    state,
    candidates: [],
    offeringCount: state === "ok" ? 5 : 0,
    invalidIds: [],
    durationMs: 12.6,
    error,
    warnings: [],
  };
}

const prevResult = (id: string, consecutiveFailures: number): SourceResult => ({
  id,
  kind: "html",
  status: "failed",
  offeringCount: 0,
  durationMs: 1,
  errorCode: "E1002",
  errorMessage: "超时",
  lastSuccessAt: "2026-10-10T00:00:00Z",
  consecutiveFailures,
});

describe("源健康度", () => {
  it("成功：lastSuccessAt = now，连续失败清零", () => {
    const { results, warnings } = buildSourceResults({
      outcomes: [outcome("litellm", "ok")],
      previous: [prevResult("litellm", 2)],
      nowIso: NOW_ISO,
      staleAlertDays: 3,
    });
    expect(results).toEqual([
      {
        id: "litellm",
        kind: "api",
        status: "ok",
        offeringCount: 5,
        durationMs: 13,
        errorCode: null,
        errorMessage: null,
        lastSuccessAt: NOW_ISO,
        consecutiveFailures: 0,
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it("失败累计 consecutiveFailures，≥ STALE_ALERT_DAYS 时给出 E1005", () => {
    const err = new PipelineError("E1002", "超时");
    const { results, warnings } = buildSourceResults({
      outcomes: [outcome("zhipu", "failed", err)],
      previous: [prevResult("zhipu", 2)],
      nowIso: NOW_ISO,
      staleAlertDays: 3,
    });
    expect(results[0]).toMatchObject({
      status: "failed",
      errorCode: "E1002",
      consecutiveFailures: 3,
      lastSuccessAt: "2026-10-10T00:00:00Z",
    });
    expect(warnings).toEqual([expect.objectContaining({ code: "E1005", sourceId: "zhipu" })]);
  });

  it("rejected（V5）记为 E3004 并计入失败", () => {
    const { results } = buildSourceResults({
      outcomes: [outcome("aliyun", "rejected")],
      previous: [],
      nowIso: NOW_ISO,
      staleAlertDays: 3,
    });
    expect(results[0]).toMatchObject({
      status: "rejected",
      errorCode: "E3004",
      consecutiveFailures: 1,
      lastSuccessAt: null,
    });
  });

  it("没运行的源沿用上次记录，不计失败；结果按 id 排序", () => {
    const { results } = buildSourceResults({
      outcomes: [outcome("zhipu", "skipped"), outcome("litellm", "ok")],
      previous: [prevResult("zhipu", 5)],
      nowIso: NOW_ISO,
      staleAlertDays: 3,
    });
    expect(results.map((r) => [r.id, r.consecutiveFailures])).toEqual([
      ["litellm", 0],
      ["zhipu", 5],
    ]);
  });

  it("manual：verifiedAt 超过 14 天给出警告", () => {
    const file = (verifiedAt: string) => ({
      file: "x.yaml",
      config: {
        source: "manual-x",
        platform: "official",
        vendor: "baidu",
        currency: "CNY" as const,
        unit: "per_1m" as const,
        sourceUrl: "https://cloud.baidu.com/x",
        verifiedAt,
        models: [],
      },
    });
    expect(checkManualFreshness([file("2026-10-04")], NOW)).toEqual([]);
    expect(checkManualFreshness([file("2026-09-01")], NOW)).toEqual([
      expect.objectContaining({ code: MANUAL_STALE_CODE, sourceId: "manual" }),
    ]);
  });
});

describe("dates", () => {
  it("今天按北京时间计算", () => {
    expect(shanghaiDate(new Date("2026-10-17T16:30:00Z"))).toBe("2026-10-18");
    expect(shanghaiDate(new Date("2026-10-17T15:59:59Z"))).toBe("2026-10-17");
    expect(monthOf("2026-10-18")).toBe("2026-10");
    expect(daysBetween("2026-10-10T00:00:00Z", NOW)).toBe(8);
    expect(daysBetween("2026-10-20T00:00:00Z", NOW)).toBe(0);
    expect(toIsoSeconds(new Date("2026-10-18T01:02:03.456Z"))).toBe("2026-10-18T01:02:03Z");
  });
});
