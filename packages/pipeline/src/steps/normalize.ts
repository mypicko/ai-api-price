/**
 * Normalize（DEV_DOCUMENT §3.3）：RawOffering → Candidate。
 * - vendorHint → providers.yaml 的 matchers
 * - 模型 ID：aliases.yaml 优先，其次 normalizeId
 * - 单位：toPerMillion（价格保持原币种）
 * - S6：notes ≤ 200 字符，名称 ≤ 100 字符
 * - S8：sourceUrl 域名必须在 vendor 或 platform 的白名单内
 */
import {
  makeModelSlug,
  makeOfferingId,
  normalizeModelId,
  toPerMillion,
  type AliasesConfig,
  type PlatformConfig,
  type ProvidersConfig,
  type RawOffering,
  type RawTier,
  type Tier,
  type VendorConfig,
  type Warning,
} from "@aipb/shared";
import type { Candidate } from "./types";
import { makeWarning } from "./types";

export const MAX_NAME_LENGTH = 100;
export const MAX_NOTES_LENGTH = 200;

/** 同一个 Offering ID 被多个源提供时的优先级：厂商官网抓取 > LiteLLM > manual（DEV §3.2） */
/**
 * 数值越大越优先；未列出的（各厂商官网抓取器、models.dev 等）默认 3。
 * manual-cn 只产出 official-cn 报价，人工核对的国内站价格要压过 models.dev 社区数据。
 */
export const SOURCE_PRIORITY: Readonly<Record<string, number>> = {
  litellm: 2,
  manual: 1,
  "manual-cn": 4,
};
const DEFAULT_SOURCE_PRIORITY = 3;

export function sourcePriority(sourceId: string): number {
  return SOURCE_PRIORITY[sourceId] ?? DEFAULT_SOURCE_PRIORITY;
}

export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

const TRUNCATE_LIMITS: Readonly<Record<string, number>> = {
  vendorHint: MAX_NAME_LENGTH,
  modelName: MAX_NAME_LENGTH,
  displayName: MAX_NAME_LENGTH,
  notes: MAX_NOTES_LENGTH,
};

/** S6：在 V1 之前截断，避免超长文本让整条报价被 schema 拒绝；输入是不可信的抓取结果 */
export function sanitizeRaw(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Readonly<Record<string, unknown>>;
  const fixes = Object.entries(TRUNCATE_LIMITS).flatMap(([key, max]) => {
    const value = record[key];
    return typeof value === "string" ? [[key, truncate(value.trim(), max)] as const] : [];
  });
  return { ...record, ...Object.fromEntries(fixes) };
}

export type VendorMatcher = (hint: string) => VendorConfig | null;

/** matchers 不区分大小写：完全相等，或作为 "xxx/" 前缀 */
export function createVendorMatcher(providers: ProvidersConfig): VendorMatcher {
  const entries = providers.vendors.map((vendor) => ({
    vendor,
    keys: [vendor.id, ...vendor.matchers].map((m) => m.toLowerCase()),
  }));
  return (hint) => {
    const lower = hint.trim().toLowerCase();
    const found = entries.find(({ keys }) =>
      keys.some((k) => lower === k || lower.startsWith(`${k}/`)),
    );
    return found?.vendor ?? null;
  };
}

export type AliasResolver = (vendorId: string, modelName: string) => string;

function stripVendorPrefix(alias: string, vendorId: string): string {
  const prefix = `${vendorId}/`;
  return alias.toLowerCase().startsWith(prefix) ? alias.slice(prefix.length) : alias;
}

/** aliases.yaml：规范 slug → 别名列表；别名可以是原始名称或规范化后的 ID */
export function createAliasResolver(aliases: AliasesConfig): AliasResolver {
  const lookup = new Map<string, string>();
  for (const [slug, list] of Object.entries(aliases)) {
    const [vendorId, ...rest] = slug.split("/");
    const canonical = normalizeModelId(rest.join("/"));
    if (!vendorId || !canonical) continue;
    for (const alias of list) {
      const bare = stripVendorPrefix(alias.trim(), vendorId);
      lookup.set(`${vendorId}|${bare.toLowerCase()}`, canonical);
      lookup.set(`${vendorId}|${normalizeModelId(bare)}`, canonical);
    }
  }
  return (vendorId, modelName) => {
    const normalized = normalizeModelId(modelName);
    return (
      lookup.get(`${vendorId}|${modelName.trim().toLowerCase()}`) ??
      lookup.get(`${vendorId}|${normalized}`) ??
      normalized
    );
  };
}

export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** S8：只允许 https，且域名在白名单内（允许子域名） */
export function isAllowedSourceUrl(url: string, domains: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && domains.some((d) => hostMatches(parsed.hostname, d));
  } catch {
    return false;
  }
}

function toTier(raw: RawTier, unit: RawOffering["unit"]): Tier {
  return {
    minInputTokens: raw.minInputTokens,
    maxInputTokens: raw.maxInputTokens,
    input: toPerMillion(raw.input, unit),
    output: toPerMillion(raw.output, unit),
    cacheRead: toPerMillion(raw.cacheRead, unit),
    cacheWrite: toPerMillion(raw.cacheWrite, unit),
  };
}

function buildPrices(
  raw: RawOffering,
): Pick<Candidate, "input" | "output" | "cacheRead" | "cacheWrite" | "tiers"> {
  const tiers = (raw.tiers ?? [])
    .map((t) => toTier(t, raw.unit))
    .toSorted((a, b) => a.minInputTokens - b.minInputTokens);
  const first = tiers[0];
  if (first) {
    // 有阶梯价时顶层价格 = 第一档（API 文档 §2.1）；第一档缺的字段用顶层值补
    return {
      input: first.input,
      output: first.output,
      cacheRead: first.cacheRead ?? toPerMillion(raw.cacheRead, raw.unit),
      cacheWrite: first.cacheWrite ?? toPerMillion(raw.cacheWrite, raw.unit),
      tiers,
    };
  }
  return {
    input: toPerMillion(raw.input, raw.unit),
    output: toPerMillion(raw.output, raw.unit),
    cacheRead: toPerMillion(raw.cacheRead, raw.unit),
    cacheWrite: toPerMillion(raw.cacheWrite, raw.unit),
    tiers: null,
  };
}

export interface NormalizeContext {
  readonly sourceId: string;
  readonly platform: PlatformConfig;
  readonly matchVendor: VendorMatcher;
  readonly resolveAlias: AliasResolver;
}

export type NormalizeOneResult =
  | { readonly kind: "ok"; readonly candidate: Candidate }
  | { readonly kind: "unknown-vendor"; readonly hint: string }
  | { readonly kind: "invalid"; readonly warning: Warning };

/**
 * 模型系列 → 研发厂商。某厂商平台上转售别家的模型（如 Mistral 上的 GLM）时，
 * 不能把它算成该厂商的「官方」模型。
 */
const MODEL_FAMILY_OWNERS: readonly (readonly [prefix: string, vendor: string])[] = [
  ["glm", "zhipu"],
  ["zai-", "zhipu"],
  ["chatglm", "zhipu"],
  ["qwen", "alibaba"],
  ["qwq", "alibaba"],
  ["llama", "meta"],
  ["kimi", "moonshot"],
  ["moonshot", "moonshot"],
  ["minimax", "minimax"],
  ["deepseek", "deepseek"],
];

export function isForeignModel(vendorId: string, model: string): boolean {
  const owner = MODEL_FAMILY_OWNERS.find(([prefix]) => model.startsWith(prefix))?.[1];
  return owner !== undefined && owner !== vendorId;
}

export function normalizeOne(raw: RawOffering, ctx: NormalizeContext): NormalizeOneResult {
  const vendor = ctx.matchVendor(raw.vendorHint);
  if (!vendor) return { kind: "unknown-vendor", hint: raw.vendorHint };
  const model = ctx.resolveAlias(vendor.id, raw.modelName);
  if (isForeignModel(vendor.id, model)) {
    return { kind: "unknown-vendor", hint: `${raw.vendorHint} 转售的 ${model}` };
  }
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(model)) {
    const message = `模型名无法规范化为合法 ID：${raw.modelName}`;
    return { kind: "invalid", warning: makeWarning("E3001", message, { sourceId: ctx.sourceId }) };
  }
  const id = makeOfferingId(ctx.platform.id, vendor.id, model);
  const domains = [...vendor.allowedSourceDomains, ...ctx.platform.allowedSourceDomains];
  if (!isAllowedSourceUrl(raw.sourceUrl, domains)) {
    const message = `sourceUrl 域名不在白名单内，已丢弃：${raw.sourceUrl}`;
    return {
      kind: "invalid",
      warning: makeWarning("E3005", message, { sourceId: ctx.sourceId, offeringId: id }),
    };
  }
  const candidate: Candidate = {
    id,
    vendor: vendor.id,
    model,
    modelSlug: makeModelSlug(vendor.id, model),
    displayName: truncate(raw.displayName ?? raw.modelName, MAX_NAME_LENGTH),
    platform: ctx.platform.id,
    source: ctx.sourceId,
    currency: raw.currency,
    ...buildPrices(raw),
    contextWindow: raw.contextWindow ?? null,
    maxOutput: raw.maxOutput ?? null,
    modalities: [...new Set(raw.modalities ?? ["text"])].toSorted(),
    sourceUrl: raw.sourceUrl,
    notes:
      raw.notes === undefined || raw.notes === "" ? null : truncate(raw.notes, MAX_NOTES_LENGTH),
  };
  return { kind: "ok", candidate };
}

export interface NormalizeResult {
  readonly candidates: readonly Candidate[];
  readonly warnings: readonly Warning[];
  readonly unknownVendors: readonly string[];
}

/** 归一化一个源的全部报价；同一源内重复的 Offering ID 只保留第一条 */
export function normalizeOfferings(
  raws: readonly RawOffering[],
  ctx: NormalizeContext,
): NormalizeResult {
  const results = raws.map((raw) => normalizeOne(raw, ctx));
  const seen = new Set<string>();
  const candidates = results
    .flatMap((r) => (r.kind === "ok" ? [r.candidate] : []))
    .filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  const warnings = results.flatMap((r) => (r.kind === "invalid" ? [r.warning] : []));
  const unknownVendors = [
    ...new Set(results.flatMap((r) => (r.kind === "unknown-vendor" ? [r.hint] : []))),
  ].toSorted();
  return { candidates, warnings, unknownVendors };
}
