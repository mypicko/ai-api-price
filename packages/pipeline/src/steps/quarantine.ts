/**
 * 隔离区状态机（DEV_DOCUMENT §3.5 V3/V4/V8、§5.2）。
 *
 *   正常 ──单日变动 > 阈值──▶ 隔离中
 *   隔离中 ──抓回旧值 / 小幅变动──▶ 正常（丢弃候选）
 *   隔离中 ──连续 2 次同一新值──▶ 放行（confirmedFromQuarantine = true）
 *   接口源同次复核一致（verified）──▶ 直接放行，不进隔离区（见 steps/verify.ts）
 *   隔离中 ──抓到另一个新值──▶ 隔离中（重新计数）
 *   approve ▶ 放行；block ▶ 保留旧值；pin ▶ 钉住价格
 *
 * 变动检测只比较原币种价格，不受汇率影响。
 */
import {
  PRICE_FIELDS,
  pctChange,
  priceEquals,
  priceSetEquals,
  type ChangeField,
  type Override,
  type PriceSet,
  type QuarantineEntry,
} from "@aipb/shared";

export const REQUIRED_CONFIRMATIONS = 2;

export interface PricedOffering extends PriceSet {
  readonly currency: "USD" | "CNY";
}

export function pickPrices(source: PriceSet): PriceSet {
  return {
    input: source.input,
    output: source.output,
    cacheRead: source.cacheRead,
    cacheWrite: source.cacheWrite,
  };
}

/** 与已发布值相比发生变化的价格字段 */
export function changedPriceFields(
  oldPrices: PriceSet,
  newPrices: PriceSet,
): readonly ChangeField[] {
  return PRICE_FIELDS.filter((field) => !priceEquals(oldPrices[field], newPrices[field])).map(
    (field) => ({
      field,
      old: oldPrices[field],
      new: newPrices[field],
      pct: pctChange(oldPrices[field], newPrices[field]),
    }),
  );
}

export function isAnomalous(fields: readonly ChangeField[], threshold: number): boolean {
  return fields.some((f) => f.pct !== null && Math.abs(f.pct) > threshold);
}

export type PriceDecision =
  | { readonly kind: "accept"; readonly confirmedFromQuarantine: boolean }
  | { readonly kind: "hold"; readonly entry: QuarantineEntry; readonly isNewEntry: boolean }
  | { readonly kind: "block" }
  | { readonly kind: "pin"; readonly prices: PriceSet };

export interface PriceDecisionInput {
  readonly offeringId: string;
  readonly candidate: PricedOffering;
  /** 上次已发布且未下架的值；没有时视为新模型 */
  readonly published: PricedOffering | null;
  readonly entry: QuarantineEntry | null;
  readonly override: Override | null;
  readonly threshold: number;
  readonly nowIso: string;
  /** 接口源在同一次运行里重新请求、数值一致 */
  readonly verified?: boolean;
}

/** pin：只替换配置里写了的字段 */
export function applyPin(
  prices: PriceSet,
  pin: Partial<Record<keyof PriceSet, number | null | undefined>>,
): PriceSet {
  const pinned = Object.entries(pin).filter(([, v]) => v !== undefined);
  return { ...prices, ...Object.fromEntries(pinned) };
}

function applyOverride(input: PriceDecisionInput): PriceDecision | null {
  const { override, entry, candidate } = input;
  if (!override) return null;
  if (override.action === "block") return { kind: "block" };
  if (override.action === "pin")
    return { kind: "pin", prices: applyPin(pickPrices(candidate), override.price ?? {}) };
  return { kind: "accept", confirmedFromQuarantine: entry !== null };
}

function holdOrRelease(input: PriceDecisionInput, fields: readonly ChangeField[]): PriceDecision {
  const { entry, candidate, nowIso, offeringId } = input;
  const prices = pickPrices(candidate);
  if (entry && priceSetEquals(entry.candidate, prices)) {
    const confirmations = entry.confirmations + 1;
    if (confirmations >= REQUIRED_CONFIRMATIONS)
      return { kind: "accept", confirmedFromQuarantine: true };
    return {
      kind: "hold",
      entry: { ...entry, fields: [...fields], lastSeenAt: nowIso, confirmations },
      isNewEntry: false,
    };
  }
  const fresh: QuarantineEntry = {
    offeringId,
    fields: [...fields],
    candidate: prices,
    firstSeenAt: nowIso,
    lastSeenAt: nowIso,
    confirmations: 1,
  };
  return { kind: "hold", entry: fresh, isNewEntry: true };
}

export function decidePrice(input: PriceDecisionInput): PriceDecision {
  const overridden = applyOverride(input);
  if (overridden) return overridden;
  const { published, candidate } = input;
  // 新模型，或币种变了（换了数据源）：没有可比的旧值
  if (!published || published.currency !== candidate.currency)
    return { kind: "accept", confirmedFromQuarantine: false };
  const fields = changedPriceFields(published, candidate);
  // 抓回旧值或正常幅度的变动：直接放行，丢弃候选
  if (!isAnomalous(fields, input.threshold))
    return { kind: "accept", confirmedFromQuarantine: false };
  if (input.verified) return { kind: "accept", confirmedFromQuarantine: true };
  return holdOrRelease(input, fields);
}
