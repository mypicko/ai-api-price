/**
 * 编程套餐（Coding Plan，DEV §3.15）：月费 + 额度说明 + 「回本次数」。
 * 套餐额度口径五花八门（5 小时积分、相对倍数、美元额度、未公开），没法统一换算成每百万 tokens 单价，
 * 所以用不依赖额度的指标比较：按用户给定的单次请求用量，算出计价模型按量付费一次多少钱，
 * 月费 ÷ 单次费用 = 每月用到多少次开始比按量付费划算（前提是额度够用）。
 */
import type { Currency, PlanFile, PlanQuotaKind, Region } from "@aipb/shared";
import type { Locale } from "./locale";
import type { SiteModel } from "./site-model";

/** 每百万 tokens 的美元价 */
export interface PricedModel {
  readonly slug: string;
  readonly displayName: string;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
}

export interface DualAmount {
  readonly usd: number;
  readonly cny: number;
}

export interface PlanRow {
  readonly id: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly region: Region;
  readonly name: string;
  readonly currency: Currency;
  readonly monthly: DualAmount;
  readonly annualMonthly: DualAmount | null;
  readonly quotaKind: PlanQuotaKind;
  readonly quota: string;
  readonly creditsUsd: number | null;
  readonly notes: string | null;
  readonly tools: string;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
  /** 用来折算按量费用的模型；数据里没有这个模型时为 null */
  readonly model: PricedModel | null;
}

export interface UsageAssumptions {
  /** 每次请求的输入 tokens（含命中缓存的部分） */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 输入中命中缓存的比例 0~1 */
  readonly cacheHitRate: number;
}

/** 编程 Agent 的典型单次请求：上下文较长、输出较短、缓存命中率高 */
export const DEFAULT_ASSUMPTIONS: UsageAssumptions = {
  inputTokens: 30_000,
  outputTokens: 1_500,
  cacheHitRate: 0.8,
};

const OFFICIAL_PLATFORMS = ["official", "official-cn"] as const;

function toDual(amount: number, currency: Currency, usdCny: number): DualAmount {
  return currency === "USD"
    ? { usd: amount, cny: amount * usdCny }
    : { usd: amount / usdCny, cny: amount };
}

function pricedModel(model: SiteModel, slug: string): PricedModel | null {
  const offering = OFFICIAL_PLATFORMS.map((p) => model.offeringsById.get(`${p}:${slug}`)).find(
    (o) => o !== undefined,
  );
  if (!offering) return null;
  const usd = offering.converted.usd;
  return {
    slug,
    displayName: offering.displayName,
    input: usd.input,
    output: usd.output,
    cacheRead: usd.cacheRead,
  };
}

export function toPlanRows(
  model: SiteModel,
  files: readonly PlanFile[],
  locale: Locale,
): readonly PlanRow[] {
  const zh = locale === "zh";
  return files
    .flatMap((file) => {
      const priced = pricedModel(model, file.breakEvenModel);
      return file.plans.map((plan) => ({
        id: plan.id,
        providerId: file.provider.id,
        providerName: zh ? file.provider.nameZh : file.provider.nameEn,
        region: file.provider.region,
        name: plan.name,
        currency: file.currency,
        monthly: toDual(plan.monthly, file.currency, model.usdCny),
        annualMonthly:
          plan.annualMonthly === undefined
            ? null
            : toDual(plan.annualMonthly, file.currency, model.usdCny),
        quotaKind: plan.quotaKind,
        quota: zh ? plan.quotaZh : plan.quotaEn,
        creditsUsd: plan.creditsUsd ?? null,
        notes: (zh ? plan.notesZh : plan.notesEn) ?? null,
        tools: zh ? file.toolsZh : file.toolsEn,
        sourceUrl: file.sourceUrl,
        verifiedAt: file.verifiedAt,
        model: priced,
      }));
    })
    .toSorted((a, b) => a.monthly.usd - b.monthly.usd || a.id.localeCompare(b.id));
}

/** 按量付费一次请求的美元费用；输入或输出价未知时为 null */
export function perRequestUsd(model: PricedModel, a: UsageAssumptions): number | null {
  if (model.input === null || model.output === null) return null;
  const cached = a.inputTokens * a.cacheHitRate;
  const fresh = a.inputTokens - cached;
  const cost =
    fresh * model.input + cached * (model.cacheRead ?? model.input) + a.outputTokens * model.output;
  return cost / 1_000_000;
}

export interface BreakEven {
  readonly perRequestUsd: number;
  /** 每月用到这么多次请求，套餐开始比按量付费便宜 */
  readonly perMonth: number;
  readonly perDay: number;
}

export function breakEven(row: PlanRow, a: UsageAssumptions): BreakEven | null {
  if (!row.model) return null;
  const cost = perRequestUsd(row.model, a);
  if (cost === null || cost <= 0) return null;
  return {
    perRequestUsd: cost,
    perMonth: Math.ceil(row.monthly.usd / cost),
    perDay: Math.ceil(row.monthly.usd / cost / 30),
  };
}

/** 含美元额度 ÷ 月费（例如 $10 含 $15 额度 → 1.5）；没有额度时为 null */
export function creditsMultiple(row: PlanRow): number | null {
  if (row.creditsUsd === null) return null;
  return Math.round((row.creditsUsd / row.monthly.usd) * 100) / 100;
}

const MAX_TOKENS = 10_000_000;

function readInt(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key));
  return Number.isInteger(value) && value > 0 && value <= MAX_TOKENS ? value : fallback;
}

/** ?in=&out=&cache=（缓存命中率用 0~100 的整数）；非法值回到默认 */
export function parseAssumptions(search: string): UsageAssumptions {
  const params = new URLSearchParams(search);
  const cache = Number(params.get("cache"));
  return {
    inputTokens: readInt(params, "in", DEFAULT_ASSUMPTIONS.inputTokens),
    outputTokens: readInt(params, "out", DEFAULT_ASSUMPTIONS.outputTokens),
    cacheHitRate:
      params.has("cache") && Number.isInteger(cache) && cache >= 0 && cache <= 100
        ? cache / 100
        : DEFAULT_ASSUMPTIONS.cacheHitRate,
  };
}

/** 默认值不写；返回值不含 ? */
export function serializeAssumptions(a: UsageAssumptions): string {
  const d = DEFAULT_ASSUMPTIONS;
  const entries: [string, string][] = [
    ["in", a.inputTokens === d.inputTokens ? "" : String(a.inputTokens)],
    ["out", a.outputTokens === d.outputTokens ? "" : String(a.outputTokens)],
    ["cache", a.cacheHitRate === d.cacheHitRate ? "" : String(Math.round(a.cacheHitRate * 100))],
  ];
  return new URLSearchParams(entries.filter(([, v]) => v !== "")).toString();
}
