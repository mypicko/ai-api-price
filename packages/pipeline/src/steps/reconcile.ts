/**
 * 把本次各源结果与上次已发布数据合并成新的 Offering 列表：
 * - 来源优先级去重（厂商官网 > LiteLLM > manual）
 * - V3/V4/V8：decidePrice（隔离区状态机 + 人工覆盖）
 * - V6 下架防抖：源成功但没抓到 → missing，连续 3 天 → removed
 * - §3.6 失败兜底：源 failed/rejected → 沿用旧值并标记 stale；skipped → 原样保留
 */
import type { Offering, Override, PriceSet, QuarantineEntry, Tier, Warning } from "@aipb/shared";
import { sourcePriority } from "./normalize";
import { stableStringify } from "./stable-json";
import { decidePrice, pickPrices, type PriceDecision } from "./quarantine";
import type { Candidate, SourceOutcome, SourceRunState } from "./types";
import { makeWarning } from "./types";

export const REMOVE_AFTER_MISSING_DAYS = 3;
const VOLATILE_KEYS: ReadonlySet<string> = new Set(["fetchedAt", "publishedAt"]);

export interface ReconcileInput {
  readonly previous: readonly Offering[];
  /** 上次 latest.json 的 dataDate，用于保证 missingDays 每天最多 +1 */
  readonly previousDataDate: string | null;
  readonly outcomes: readonly SourceOutcome[];
  readonly quarantine: readonly QuarantineEntry[];
  readonly overrides: ReadonlyMap<string, Override>;
  readonly threshold: number;
  readonly nowIso: string;
  readonly today: string;
}

export interface ReconcileResult {
  readonly offerings: readonly Offering[];
  readonly quarantine: readonly QuarantineEntry[];
  readonly newlyQuarantined: readonly QuarantineEntry[];
  /** 本次从隔离区放行的 Offering ID */
  readonly confirmed: ReadonlySet<string>;
  readonly warnings: readonly Warning[];
}

/** 不随每次抓取变化的内容；用来判断 publishedAt 是否需要更新 */
export function offeringContentKey(offering: Offering): string {
  return stableStringify(
    Object.fromEntries(Object.entries(offering).filter(([key]) => !VOLATILE_KEYS.has(key))),
  );
}

interface Context {
  readonly input: ReconcileInput;
  readonly stateOf: (sourceId: string) => SourceRunState;
  readonly invalidIds: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, QuarantineEntry>;
}

interface Resolved {
  readonly offering: Offering | null;
  /** undefined = 保留原有隔离条目；null = 删除 */
  readonly entry?: QuarantineEntry | null;
  readonly isNewEntry?: boolean;
  readonly confirmed?: boolean;
}

function pickFreshCandidates(outcomes: readonly SourceOutcome[]): ReadonlyMap<string, Candidate> {
  const fresh = outcomes
    .filter((o) => o.state === "ok")
    .flatMap((o) => o.candidates)
    .toSorted((a, b) => sourcePriority(b.source) - sourcePriority(a.source));
  // 反转后构造 Map：同一 ID 由优先级最高（排序最前）的候选最后写入
  return new Map(fresh.toReversed().map((c) => [c.id, c] as const));
}

function buildOffering(
  c: Candidate,
  prices: PriceSet,
  tiers: readonly Tier[] | null,
  ctx: Context,
  prev?: Offering,
): Offering {
  const { nowIso, today } = ctx.input;
  const offering: Offering = {
    ...c,
    ...prices,
    tiers: tiers === null ? null : [...tiers],
    isFree: prices.input === 0 && prices.output === 0,
    stale: false,
    status: "active",
    missingDays: 0,
    firstSeenAt: prev?.firstSeenAt ?? today,
    fetchedAt: nowIso,
    publishedAt: nowIso,
  };
  if (prev && offeringContentKey(prev) === offeringContentKey(offering)) {
    return { ...offering, publishedAt: prev.publishedAt };
  }
  return offering;
}

function holdWarning(entry: QuarantineEntry): Warning {
  const detail = entry.fields
    .map(
      (f) =>
        `${f.field} ${f.old ?? "—"} → ${f.new ?? "—"}${f.pct === null ? "" : `（${Math.round(f.pct * 100)}%）`}`,
    )
    .join("，");
  return makeWarning("W3003", `价格突变，已进入隔离区：${detail}`, {
    offeringId: entry.offeringId,
  });
}

function resolveDecision(
  decision: PriceDecision,
  c: Candidate,
  ctx: Context,
  prev: Offering | undefined,
): Resolved {
  const published = prev && prev.status !== "removed" ? prev : undefined;
  switch (decision.kind) {
    case "accept":
      return {
        offering: buildOffering(c, pickPrices(c), c.tiers, ctx, prev),
        entry: null,
        confirmed: decision.confirmedFromQuarantine,
      };
    case "pin":
      return { offering: buildOffering(c, decision.prices, c.tiers, ctx, prev), entry: null };
    case "block":
      return {
        offering: published ? { ...published, stale: false, fetchedAt: ctx.input.nowIso } : null,
        entry: null,
      };
    case "hold": {
      const held = published
        ? buildOffering(c, pickPrices(published), published.tiers, ctx, prev)
        : null;
      return { offering: held, entry: decision.entry, isNewEntry: decision.isNewEntry };
    }
  }
}

function resolveFresh(c: Candidate, prev: Offering | undefined, ctx: Context): Resolved {
  const published = prev && prev.status !== "removed" ? prev : null;
  const decision = decidePrice({
    offeringId: c.id,
    candidate: c,
    published,
    entry: ctx.entries.get(c.id) ?? null,
    override: ctx.input.overrides.get(c.id) ?? null,
    threshold: ctx.input.threshold,
    nowIso: ctx.input.nowIso,
  });
  return resolveDecision(decision, c, ctx, prev);
}

/** V6：源成功但本次没抓到 */
function markMissing(prev: Offering, ctx: Context): Offering {
  const { previousDataDate, today, nowIso } = ctx.input;
  const missingDays =
    prev.status === "active"
      ? 1
      : previousDataDate !== today
        ? prev.missingDays + 1
        : prev.missingDays;
  const status = missingDays >= REMOVE_AFTER_MISSING_DAYS ? "removed" : "missing";
  return { ...prev, stale: false, status, missingDays, publishedAt: nowIso };
}

function resolveCarried(prev: Offering, ctx: Context): Offering {
  if (prev.status === "removed") return prev;
  const state = ctx.stateOf(prev.source);
  if (state === "skipped") return prev;
  if (state === "failed" || state === "rejected")
    return prev.stale ? prev : { ...prev, stale: true };
  // 源成功：抓到了但被 V2 丢弃的沿用旧值；真的没抓到的进入下架防抖
  if (ctx.invalidIds.has(prev.id)) return prev.stale ? prev : { ...prev, stale: true };
  return markMissing(prev, ctx);
}

function shouldUseFresh(c: Candidate, prev: Offering | undefined, ctx: Context): boolean {
  if (!prev || prev.status === "removed" || ctx.stateOf(prev.source) === "ok") return true;
  // 高优先级的源这次失败/没运行：继续沿用它的旧数据，避免币种和来源来回切换
  return sourcePriority(c.source) >= sourcePriority(prev.source);
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const states = new Map(input.outcomes.map((o) => [o.id, o.state] as const));
  const ctx: Context = {
    input,
    stateOf: (id) => states.get(id) ?? "skipped",
    invalidIds: new Set(
      input.outcomes.filter((o) => o.state === "ok").flatMap((o) => o.invalidIds),
    ),
    entries: new Map(input.quarantine.map((e) => [e.offeringId, e] as const)),
  };
  const prevById = new Map(input.previous.map((o) => [o.id, o] as const));
  const fresh = pickFreshCandidates(input.outcomes);
  const ids = [...new Set([...prevById.keys(), ...fresh.keys()])].toSorted();

  const resolved = ids.map((id): Resolved => {
    const prev = prevById.get(id);
    const c = fresh.get(id);
    if (c && shouldUseFresh(c, prev, ctx)) return resolveFresh(c, prev, ctx);
    return { offering: prev ? resolveCarried(prev, ctx) : null };
  });

  const offerings = resolved.flatMap((r) => (r.offering ? [r.offering] : []));
  const liveIds = new Set(offerings.filter((o) => o.status !== "removed").map((o) => o.id));
  const quarantine = ids
    .map((id, i) => {
      const r = resolved[i];
      return r?.entry === undefined ? (ctx.entries.get(id) ?? null) : r.entry;
    })
    .filter((e): e is QuarantineEntry => e !== null && liveIds.has(e.offeringId));
  const newlyQuarantined = resolved.flatMap((r) => (r.isNewEntry && r.entry ? [r.entry] : []));
  const confirmed = new Set(
    resolved.flatMap((r) => (r.confirmed && r.offering ? [r.offering.id] : [])),
  );
  return {
    offerings,
    quarantine,
    newlyQuarantined,
    confirmed,
    warnings: newlyQuarantined.map(holdWarning),
  };
}
