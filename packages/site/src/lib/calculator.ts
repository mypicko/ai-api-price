/**
 * 成本计算器（DEV §3.11）。全部在浏览器本地运行，不能引入 zod。
 */
import type { Currency, PriceSet, Tier } from "@aipb/shared";
import { convertCurrency } from "./shared-client";

export interface CalcOffering extends PriceSet {
  readonly id: string;
  readonly modelSlug: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly vendorName: string;
  readonly platform: string;
  readonly platformName: string;
  readonly currency: Currency;
  readonly tiers: readonly Tier[] | null;
}

export type CalcMode = "perRequest" | "monthly";

export interface CalcInputs {
  readonly mode: CalcMode;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly requestsPerDay: number;
  readonly monthlyInput: number;
  readonly monthlyOutput: number;
  /** 0 ~ 1 */
  readonly cacheHitRate: number;
  readonly daysPerMonth: number;
}

export const DEFAULT_INPUTS: CalcInputs = {
  mode: "perRequest",
  inputTokens: 2000,
  outputTokens: 500,
  requestsPerDay: 1000,
  monthlyInput: 60_000_000,
  monthlyOutput: 15_000_000,
  cacheHitRate: 0,
  daysPerMonth: 30,
};

export const RESULT_LIMIT = 20;

export interface Usage {
  readonly monthlyInput: number;
  readonly monthlyOutput: number;
  readonly cachedInput: number;
  /** 选阶梯价用；按月总量输入时为 null（使用第一档） */
  readonly perRequestInput: number | null;
}

const SUFFIX: Readonly<Record<string, number>> = {
  "": 1,
  k: 1e3,
  m: 1e6,
  b: 1e9,
  千: 1e3,
  万: 1e4,
  亿: 1e8,
};

/** "2k" → 2000，"1.5m" → 1500000，"2,000" → 2000，"10万" → 100000；非法或负数返回 null */
export function parseTokenInput(text: string): number | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[,，_\s]/g, "");
  const match = /^(\d+(?:\.\d+)?|\.\d+)(k|m|b|千|万|亿)?$/.exec(normalized);
  if (!match) return null;
  const [, num = "", suffix = ""] = match;
  const multiplier = SUFFIX[suffix];
  if (multiplier === undefined) return null;
  return Math.round(Number(num) * multiplier);
}

/** 百分比输入（"30" / "30%"）→ 0~1；超出范围返回 null */
export function parsePercent(text: string): number | null {
  const normalized = text.trim().replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value >= 0 && value <= 100 ? value / 100 : null;
}

export function computeUsage(inputs: CalcInputs): Usage {
  const rate = Math.min(1, Math.max(0, inputs.cacheHitRate));
  if (inputs.mode === "monthly") {
    return {
      monthlyInput: inputs.monthlyInput,
      monthlyOutput: inputs.monthlyOutput,
      cachedInput: inputs.monthlyInput * rate,
      perRequestInput: null,
    };
  }
  const requests = inputs.requestsPerDay * inputs.daysPerMonth;
  const monthlyInput = inputs.inputTokens * requests;
  return {
    monthlyInput,
    monthlyOutput: inputs.outputTokens * requests,
    cachedInput: monthlyInput * rate,
    perRequestInput: inputs.inputTokens,
  };
}

export interface SelectedPrices {
  readonly prices: PriceSet;
  /** 从 0 开始；没有阶梯价时为 null */
  readonly tierIndex: number | null;
}

/** 按单次请求输入 token 落在哪一档选价格；没有阶梯价时用顶层价格 */
export function selectTier(offering: CalcOffering, perRequestInput: number | null): SelectedPrices {
  const tiers = offering.tiers ?? [];
  if (tiers.length === 0) {
    return { prices: offering, tierIndex: null };
  }
  const tokens = perRequestInput ?? 0;
  const index = tiers.findIndex(
    (tier) =>
      tokens >= tier.minInputTokens &&
      (tier.maxInputTokens === null || tokens < tier.maxInputTokens),
  );
  const chosen = index === -1 ? tiers.length - 1 : index;
  const tier = tiers[chosen] ?? tiers[0];
  return { prices: tier ?? offering, tierIndex: chosen };
}

/** 月成本（原币种）；输入价或输出价缺失时无法计算，返回 null */
export function monthlyCost(prices: PriceSet, usage: Usage): number | null {
  if (prices.input === null || prices.output === null) return null;
  const uncached = usage.monthlyInput - usage.cachedInput;
  const cachePrice = prices.cacheRead ?? prices.input;
  return (
    (uncached * prices.input +
      usage.cachedInput * cachePrice +
      usage.monthlyOutput * prices.output) /
    1_000_000
  );
}

export interface CalcResult {
  readonly offering: CalcOffering;
  readonly tierIndex: number | null;
  /** 原币种月成本 */
  readonly costOriginal: number;
  /** 所选币种月成本 */
  readonly cost: number;
  readonly isConverted: boolean;
}

export interface RankOptions {
  readonly currency: Currency;
  readonly usdCny: number;
  /** 空数组 = 全部厂商 */
  readonly vendors: readonly string[];
  readonly limit?: number;
}

export function rankOfferings(
  offerings: readonly CalcOffering[],
  usage: Usage,
  options: RankOptions,
): readonly CalcResult[] {
  const { currency, usdCny, vendors, limit = RESULT_LIMIT } = options;
  const results = offerings
    .filter((o) => vendors.length === 0 || vendors.includes(o.vendor))
    .flatMap((offering): CalcResult[] => {
      const selected = selectTier(offering, usage.perRequestInput);
      const costOriginal = monthlyCost(selected.prices, usage);
      if (costOriginal === null) return [];
      const cost =
        convertCurrency(costOriginal, offering.currency, currency, usdCny) ?? costOriginal;
      return [
        {
          offering,
          tierIndex: selected.tierIndex,
          costOriginal,
          cost,
          isConverted: offering.currency !== currency,
        },
      ];
    });
  return results
    .toSorted((a, b) => a.cost - b.cost || a.offering.id.localeCompare(b.offering.id))
    .slice(0, limit);
}
