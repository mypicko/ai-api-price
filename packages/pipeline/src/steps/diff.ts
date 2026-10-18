/**
 * Diff（DEV_DOCUMENT §3.7、API 文档 §2.4）：新发布数据 vs 上次 latest.json → ChangeEvent[]。
 * - 一个 Offering 的多个价格字段变化合并成一个事件；有涨有降归为 price_up
 * - 只比较原币种价格（币种不同说明换了数据源，不生成价格事件）
 * - 上下文长度变化单独生成 context_change
 * - 事件 ID：<YYYY-MM-DD>-<offeringId>-<序号>，序号在当天内递增（同一天多次运行也不重复）
 */
import {
  pctChange,
  type ChangeEvent,
  type ChangeField,
  type ChangeType,
  type Offering,
} from "@aipb/shared";
import { changedPriceFields } from "./quarantine";

export interface DiffInput {
  readonly previous: readonly Offering[];
  readonly next: readonly Offering[];
  readonly confirmed: ReadonlySet<string>;
  readonly nowIso: string;
  readonly today: string;
  /** 当月已有事件，用于计算序号 */
  readonly existingEvents: readonly ChangeEvent[];
  /** 本次首次成功运行的源：只建立基线，不为它们生成 new_model 事件 */
  readonly baselineSources?: ReadonlySet<string>;
}

interface EventDraft {
  readonly type: ChangeType;
  readonly offering: Offering;
  readonly fields: readonly ChangeField[];
}

/** 只有 null ↔ 数值 的变化不算涨跌（例如新增了缓存价） */
export function classifyPriceChange(
  fields: readonly ChangeField[],
): "price_up" | "price_down" | null {
  const numeric = fields.filter((f) => f.old !== null && f.new !== null);
  if (numeric.some((f) => (f.new ?? 0) > (f.old ?? 0))) return "price_up";
  if (numeric.some((f) => (f.new ?? 0) < (f.old ?? 0))) return "price_down";
  return null;
}

function statusDrafts(
  prev: Offering | undefined,
  next: Offering,
  baselineSources: ReadonlySet<string>,
): readonly EventDraft[] | null {
  if (!prev) {
    if (next.status === "removed" || baselineSources.has(next.source)) return [];
    return [{ type: "new_model", offering: next, fields: [] }];
  }
  if (prev.status === "removed" && next.status !== "removed")
    return [{ type: "restored", offering: next, fields: [] }];
  if (prev.status !== "removed" && next.status === "removed")
    return [{ type: "removed", offering: next, fields: [] }];
  if (next.status === "removed") return [];
  return null;
}

function contextDraft(prev: Offering, next: Offering): EventDraft | null {
  if (
    prev.contextWindow === null ||
    next.contextWindow === null ||
    prev.contextWindow === next.contextWindow
  )
    return null;
  const field: ChangeField = {
    field: "contextWindow",
    old: prev.contextWindow,
    new: next.contextWindow,
    pct: pctChange(prev.contextWindow, next.contextWindow),
  };
  return { type: "context_change", offering: next, fields: [field] };
}

function draftsFor(
  prev: Offering | undefined,
  next: Offering,
  baselineSources: ReadonlySet<string>,
): readonly EventDraft[] {
  const byStatus = statusDrafts(prev, next, baselineSources);
  if (byStatus !== null || !prev) return byStatus ?? [];
  return [priceDraft(prev, next), contextDraft(prev, next)].filter(
    (d): d is EventDraft => d !== null,
  );
}

function priceDraft(prev: Offering, next: Offering): EventDraft | null {
  if (prev.currency !== next.currency) return null;
  const fields = changedPriceFields(prev, next);
  const type = classifyPriceChange(fields);
  return type ? { type, offering: next, fields } : null;
}

function nextSequence(existing: readonly ChangeEvent[], prefix: string): number {
  const used = existing
    .filter((e) => e.id.startsWith(prefix))
    .map((e) => Number(e.id.slice(prefix.length)))
    .filter((n) => Number.isInteger(n));
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

export function diffOfferings(input: DiffInput): readonly ChangeEvent[] {
  const prevById = new Map(input.previous.map((o) => [o.id, o] as const));
  const baseline = input.baselineSources ?? new Set<string>();
  const drafts = input.next.flatMap((next) => draftsFor(prevById.get(next.id), next, baseline));
  const counters = new Map<string, number>();
  return drafts.map((draft) => {
    const { offering } = draft;
    const prefix = `${input.today}-${offering.id}-`;
    const seq = counters.get(prefix) ?? nextSequence(input.existingEvents, prefix);
    counters.set(prefix, seq + 1);
    return {
      id: `${prefix}${seq}`,
      type: draft.type,
      offeringId: offering.id,
      vendor: offering.vendor,
      modelSlug: offering.modelSlug,
      displayName: offering.displayName,
      platform: offering.platform,
      currency: offering.currency,
      fields: [...draft.fields],
      confirmedFromQuarantine:
        input.confirmed.has(offering.id) &&
        (draft.type === "price_up" || draft.type === "price_down"),
      detectedAt: input.nowIso,
    };
  });
}
