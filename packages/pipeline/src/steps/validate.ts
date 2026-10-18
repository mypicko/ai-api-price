/**
 * Validate（DEV_DOCUMENT §3.5）中与单个源相关的规则：
 * - V1 结构：RawOfferingSchema，不符合的丢弃并记 E3001
 * - V2 取值范围：换算成 USD 后 > MAX_PRICE_USD_PER_1M 的丢弃并记 E3002（负数已被 V1 拦截）
 * - V5 模型数骤降：本次条数 < 上次的 50%，整个源被拒绝，记 E3004（manual 源不适用）
 * - V8 人工覆盖：取当前生效（until ≥ 今天）的 overrides
 * V3/V4 见 quarantine.ts，V6 见 reconcile.ts，V7 见 cross-check.ts。
 */
import {
  convertCurrency,
  MAX_PRICE_USD_PER_1M,
  PRICE_FIELDS,
  RawOfferingSchema,
  type Override,
  type RawOffering,
  type Warning,
} from "@aipb/shared";
import type { Candidate } from "./types";
import { makeWarning } from "./types";

export const MODEL_COUNT_DROP_RATIO = 0.5;
/** 不适用 V5 的源 */
export const V5_EXEMPT_SOURCES: ReadonlySet<string> = new Set(["manual"]);

export interface StructureResult {
  readonly valid: readonly RawOffering[];
  readonly warnings: readonly Warning[];
}

/** V1：逐条校验抓取器输出 */
export function checkStructure(raws: readonly unknown[], sourceId: string): StructureResult {
  const results = raws.map((raw) => ({ raw, parsed: RawOfferingSchema.safeParse(raw) }));
  const valid = results.flatMap((r) => (r.parsed.success ? [r.parsed.data] : []));
  const warnings = results.flatMap((r) => {
    if (r.parsed.success) return [];
    const name =
      typeof r.raw === "object" && r.raw !== null && "modelName" in r.raw
        ? String(r.raw.modelName)
        : "?";
    const detail = r.parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return [makeWarning("E3001", `结构不符合 schema（${name}）：${detail}`, { sourceId })];
  });
  return { valid, warnings };
}

function candidatePrices(candidate: Candidate): readonly (number | null)[] {
  const top = PRICE_FIELDS.map((f) => candidate[f]);
  const tiers = (candidate.tiers ?? []).flatMap((t) => PRICE_FIELDS.map((f) => t[f]));
  return [...top, ...tiers];
}

export function exceedsRange(candidate: Candidate, usdCny: number): boolean {
  return candidatePrices(candidate).some((price) => {
    if (price === null) return false;
    const usd = convertCurrency(price, candidate.currency, "USD", usdCny) ?? 0;
    return price < 0 || usd > MAX_PRICE_USD_PER_1M;
  });
}

export interface RangeResult {
  readonly valid: readonly Candidate[];
  readonly invalidIds: readonly string[];
  readonly warnings: readonly Warning[];
}

/** V2：汇率只用于判断上限，存储的仍是原币种价格 */
export function checkPriceRange(candidates: readonly Candidate[], usdCny: number): RangeResult {
  const invalid = candidates.filter((c) => exceedsRange(c, usdCny));
  const invalidIds = new Set(invalid.map((c) => c.id));
  return {
    valid: candidates.filter((c) => !invalidIds.has(c.id)),
    invalidIds: [...invalidIds],
    warnings: invalid.map((c) =>
      makeWarning(
        "E3002",
        `价格超出合理范围（> ${MAX_PRICE_USD_PER_1M} USD/1M）：${c.displayName}`,
        {
          sourceId: c.source,
          offeringId: c.id,
        },
      ),
    ),
  };
}

/** V5：返回 E3004 警告表示整个源被拒绝；上次没有数据时不判断 */
export function checkModelCountDrop(
  sourceId: string,
  currentCount: number,
  previousCount: number,
): Warning | null {
  if (V5_EXEMPT_SOURCES.has(sourceId) || previousCount === 0) return null;
  if (currentCount >= previousCount * MODEL_COUNT_DROP_RATIO) return null;
  return makeWarning("E3004", `模型数骤降：${previousCount} → ${currentCount}，整个源沿用旧数据`, {
    sourceId,
  });
}

/** V8：只保留未过期的覆盖（until 当天仍生效）；同一个 offering 有多条时取最后一条 */
export function activeOverrides(
  overrides: readonly Override[],
  today: string,
): ReadonlyMap<string, Override> {
  return new Map(overrides.filter((o) => o.until >= today).map((o) => [o.offering, o] as const));
}
