/**
 * 汇率（DEV_DOCUMENT §3.4）兜底链：
 *   frankfurter → er-api → 沿用 fx.json 上次的汇率（W2001）→ 超过 7 天未成功用 FX_FALLBACK_RATE（E2002）
 * 汇率只用于展示换算和 V2/V7 的判断，变动检测不受汇率影响。
 */
import { FxRateSchema, type FxFile, type FxRate, type Warning } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";
import { daysBetween, shanghaiDate, toIsoSeconds } from "../steps/dates";
import { makeWarning } from "../steps/types";

export const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=CNY";
export const ER_API_URL = "https://open.er-api.com/v6/latest/USD";
export const FX_MAX_AGE_DAYS = 7;
export const FX_HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;
/** 合理区间之外的汇率视为接口返回异常 */
const RATE_SCHEMA = z.number().min(1).max(20);

const FrankfurterSchema = z.object({ date: z.iso.date(), rates: z.object({ CNY: RATE_SCHEMA }) });
const ErApiSchema = z.object({
  result: z.literal("success"),
  time_last_update_unix: z.number().int().positive(),
  rates: z.object({ CNY: RATE_SCHEMA }),
});

export interface FetchedRate {
  readonly date: string;
  readonly usdCny: number;
}

function parseResponse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new PipelineError("E2001", `${label} 响应格式不符合预期`);
  return result.data;
}

export async function fetchFrankfurter(http: HttpClient): Promise<FetchedRate> {
  const data = parseResponse(FrankfurterSchema, await http.getJson(FRANKFURTER_URL), "frankfurter");
  return { date: data.date, usdCny: data.rates.CNY };
}

export async function fetchErApi(http: HttpClient): Promise<FetchedRate> {
  const data = parseResponse(ErApiSchema, await http.getJson(ER_API_URL), "er-api");
  return {
    date: shanghaiDate(new Date(data.time_last_update_unix * 1000)),
    usdCny: data.rates.CNY,
  };
}

export interface ResolveFxInput {
  readonly http: HttpClient;
  readonly previous: FxFile | null;
  readonly now: Date;
  readonly fallbackRate: number;
  readonly logger: Logger;
}

export interface ResolveFxResult {
  readonly file: FxFile;
  readonly rate: FxRate;
  readonly warnings: readonly Warning[];
}

function mergeHistory(history: readonly FxRate[], rate: FxRate, today: string): readonly FxRate[] {
  const byDate = new Map([...history, rate].map((r) => [r.date, r] as const));
  const sorted = [...byDate.values()].toSorted((a, b) => a.date.localeCompare(b.date));
  const cutoffDate = new Date(Date.parse(`${today}T00:00:00Z`) - FX_HISTORY_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return sorted.filter((r) => r.date > cutoffDate);
}

async function tryProviders(
  http: HttpClient,
  logger: Logger,
): Promise<{ readonly rate: FetchedRate; readonly provider: "frankfurter" | "er-api" } | null> {
  const providers = [
    { provider: "frankfurter" as const, fetch: fetchFrankfurter },
    { provider: "er-api" as const, fetch: fetchErApi },
  ];
  for (const { provider, fetch } of providers) {
    try {
      return { rate: await fetch(http), provider };
    } catch (error) {
      logger.warn("汇率接口失败，尝试下一个", { provider, error });
    }
  }
  return null;
}

export async function resolveFx(input: ResolveFxInput): Promise<ResolveFxResult> {
  const { previous, now, logger } = input;
  const nowIso = toIsoSeconds(now);
  const today = shanghaiDate(now);
  const history = previous?.history ?? [];
  const fetched = await tryProviders(input.http, logger);
  if (fetched) {
    const rate = FxRateSchema.parse({ ...fetched.rate, provider: fetched.provider });
    return {
      rate,
      warnings: [],
      file: {
        latest: rate,
        lastSuccessAt: nowIso,
        history: [...mergeHistory(history, rate, today)],
      },
    };
  }
  const lastSuccessAt = previous?.lastSuccessAt ?? null;
  const fresh =
    previous !== null &&
    lastSuccessAt !== null &&
    daysBetween(lastSuccessAt, now) < FX_MAX_AGE_DAYS;
  if (fresh) {
    const rate: FxRate = { ...previous.latest, provider: "previous" };
    const warning = makeWarning(
      "W2001",
      `当日汇率获取失败，沿用上次汇率 ${rate.usdCny}（${rate.date}）`,
    );
    return {
      rate,
      warnings: [warning],
      file: { ...previous, latest: rate, history: [...history] },
    };
  }
  const rate: FxRate = { date: today, usdCny: input.fallbackRate, provider: "fallback" };
  const warning = makeWarning(
    "E2002",
    `汇率超过 ${FX_MAX_AGE_DAYS} 天未获取成功，使用兜底汇率 ${input.fallbackRate}`,
  );
  return {
    rate,
    warnings: [warning],
    file: { latest: rate, lastSuccessAt, history: [...mergeHistory(history, rate, today)] },
  };
}
