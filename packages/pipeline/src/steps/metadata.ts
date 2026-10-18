/**
 * 元数据补全：只填空缺的展示名、上下文长度、最大输出，不改任何价格。
 * - 来源 1：外部元数据（目前是 models.dev 的 alibaba-cn，阿里官网抓取器拿不到这些字段）
 * - 来源 2：上一次已发布的同一 Offering，避免外部数据某天拿不到时字段来回变动
 */
import { makeModelSlug, type Offering } from "@aipb/shared";
import type { RawModelMetadata } from "../sources/modelsdev";
import { isRawName } from "./display-names";
import type { AliasResolver, VendorMatcher } from "./normalize";

export interface ModelMetadata {
  readonly modelSlug: string;
  readonly displayName: string | null;
  readonly contextWindow: number | null;
  readonly maxOutput: number | null;
}

function friendlyName(name: string | null | undefined, model: string): string | null {
  return name && !isRawName(name, model) ? name : null;
}

/** 带日期的快照：qwen-plus-2025-01-25 → { base: "qwen-plus", date: "2025-01-25" } */
const SNAPSHOT_PATTERN = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

/** 快照没有自己的元数据时，借用基础模型的名称并附上日期；上下文不借（快照可能不同） */
function snapshotName(
  offering: Offering,
  bySlug: ReadonlyMap<string, ModelMetadata>,
): string | null {
  const match = SNAPSHOT_PATTERN.exec(offering.model);
  if (!match) return null;
  const [, base, date] = match;
  const baseName = bySlug.get(`${offering.vendor}/${base}`)?.displayName;
  return baseName && !isRawName(baseName, base ?? "") ? `${baseName} (${date})` : null;
}

function enrichOne(
  offering: Offering,
  bySlug: ReadonlyMap<string, ModelMetadata>,
  prev: Offering | undefined,
): Offering {
  const meta = bySlug.get(offering.modelSlug);
  const name = isRawName(offering.displayName, offering.model)
    ? (friendlyName(meta?.displayName, offering.model) ??
      snapshotName(offering, bySlug) ??
      friendlyName(prev?.displayName, offering.model))
    : null;
  const contextWindow =
    offering.contextWindow ?? meta?.contextWindow ?? prev?.contextWindow ?? null;
  const maxOutput = offering.maxOutput ?? meta?.maxOutput ?? prev?.maxOutput ?? null;
  const changed =
    name !== null || contextWindow !== offering.contextWindow || maxOutput !== offering.maxOutput;
  if (!changed) return offering;
  return { ...offering, ...(name === null ? {} : { displayName: name }), contextWindow, maxOutput };
}

export function enrichMetadata(
  offerings: readonly Offering[],
  metadata: readonly ModelMetadata[],
  previous: readonly Offering[],
): readonly Offering[] {
  const bySlug = new Map(metadata.map((m) => [m.modelSlug, m] as const));
  const prevById = new Map(previous.map((o) => [o.id, o] as const));
  return offerings.map((o) => enrichOne(o, bySlug, prevById.get(o.id)));
}

/** 原始元数据 → 规范 modelSlug（与报价走同一套厂商匹配和别名规则） */
export function resolveMetadata(
  raws: readonly RawModelMetadata[],
  matchVendor: VendorMatcher,
  resolveAlias: AliasResolver,
): ModelMetadata[] {
  return raws.flatMap((raw) => {
    const vendor = matchVendor(raw.vendorHint);
    if (!vendor) return [];
    const model = resolveAlias(vendor.id, raw.modelName);
    return [
      {
        modelSlug: makeModelSlug(vendor.id, model),
        displayName: raw.displayName,
        contextWindow: raw.contextWindow,
        maxOutput: raw.maxOutput,
      },
    ];
  });
}
