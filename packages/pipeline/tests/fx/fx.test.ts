import type { FxFile } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { silentLogger } from "../../src/core/logger";
import { ER_API_URL, FRANKFURTER_URL, resolveFx } from "../../src/fx/fx";
import { createFakeHttp, NOW, NOW_ISO } from "../helpers";

const FRANKFURTER_OK = JSON.stringify({
  amount: 1,
  base: "USD",
  date: "2026-10-17",
  rates: { CNY: 6.68 },
});
const ER_API_OK = JSON.stringify({
  result: "success",
  time_last_update_unix: 1792195201,
  rates: { CNY: 6.7, USD: 1 },
});
const DOWN = new PipelineError("E1001", "down", { retryable: true });

function previous(lastSuccessAt: string | null): FxFile {
  return {
    latest: { date: "2026-10-15", usdCny: 6.9, provider: "frankfurter" },
    lastSuccessAt,
    history: [{ date: "2026-10-15", usdCny: 6.9, provider: "frankfurter" }],
  };
}

const base = { now: NOW, fallbackRate: 7.1, logger: silentLogger };

describe("fx", () => {
  it("主源 frankfurter 成功", async () => {
    const http = createFakeHttp({ [FRANKFURTER_URL]: FRANKFURTER_OK });
    const result = await resolveFx({ ...base, http, previous: previous("2026-10-15T00:00:00Z") });
    expect(result.rate).toEqual({ date: "2026-10-17", usdCny: 6.68, provider: "frankfurter" });
    expect(result.warnings).toEqual([]);
    expect(result.file.lastSuccessAt).toBe(NOW_ISO);
    expect(result.file.history.map((h) => h.date)).toEqual(["2026-10-15", "2026-10-17"]);
  });

  it("主源失败时用备源 er-api", async () => {
    const http = createFakeHttp({ [FRANKFURTER_URL]: DOWN, [ER_API_URL]: ER_API_OK });
    const result = await resolveFx({ ...base, http, previous: null });
    expect(result.rate).toMatchObject({ usdCny: 6.7, provider: "er-api" });
    expect(result.rate.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("主源返回格式异常时也走备源", async () => {
    const http = createFakeHttp({
      [FRANKFURTER_URL]: '{"rates":{"CNY":"x"}}',
      [ER_API_URL]: ER_API_OK,
    });
    const result = await resolveFx({ ...base, http, previous: null });
    expect(result.rate.provider).toBe("er-api");
  });

  it("两个都失败：7 天内沿用上次汇率并记 W2001", async () => {
    const http = createFakeHttp({ [FRANKFURTER_URL]: DOWN, [ER_API_URL]: DOWN });
    const result = await resolveFx({ ...base, http, previous: previous("2026-10-15T00:00:00Z") });
    expect(result.rate).toEqual({ date: "2026-10-15", usdCny: 6.9, provider: "previous" });
    expect(result.warnings.map((w) => w.code)).toEqual(["W2001"]);
    expect(result.file.lastSuccessAt).toBe("2026-10-15T00:00:00Z");
  });

  it("超过 7 天没成功：使用 FX_FALLBACK_RATE 并记 E2002", async () => {
    const http = createFakeHttp({ [FRANKFURTER_URL]: DOWN, [ER_API_URL]: DOWN });
    const result = await resolveFx({ ...base, http, previous: previous("2026-10-01T00:00:00Z") });
    expect(result.rate).toEqual({ date: "2026-10-18", usdCny: 7.1, provider: "fallback" });
    expect(result.warnings.map((w) => w.code)).toEqual(["E2002"]);
    expect(result.file.lastSuccessAt).toBe("2026-10-01T00:00:00Z");
  });

  it("从来没有成功过：直接使用兜底汇率", async () => {
    const http = createFakeHttp({ [FRANKFURTER_URL]: DOWN, [ER_API_URL]: DOWN });
    const result = await resolveFx({ ...base, http, previous: null });
    expect(result.rate.provider).toBe("fallback");
    expect(result.file.lastSuccessAt).toBeNull();
  });

  it("history 只保留最近 90 天，同一天只保留一条", async () => {
    const old: FxFile = {
      latest: { date: "2026-10-17", usdCny: 6.6, provider: "frankfurter" },
      lastSuccessAt: "2026-10-17T00:00:00Z",
      history: [
        { date: "2026-06-01", usdCny: 7, provider: "frankfurter" },
        { date: "2026-10-17", usdCny: 6.6, provider: "frankfurter" },
      ],
    };
    const http = createFakeHttp({ [FRANKFURTER_URL]: FRANKFURTER_OK });
    const result = await resolveFx({ ...base, http, previous: old });
    expect(result.file.history).toEqual([
      { date: "2026-10-17", usdCny: 6.68, provider: "frankfurter" },
    ]);
  });
});
