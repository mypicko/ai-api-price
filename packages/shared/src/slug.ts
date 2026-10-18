/**
 * 模型/厂商 ID 规范化（DEV_DOCUMENT §3.3）。
 * 规范 ID 只包含 [a-z0-9.-]。
 */

/** "Claude Sonnet 4.5" → "claude-sonnet-4.5"；"qwen_plus" → "qwen-plus" */
export function normalizeId(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_/:]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/**
 * 模型 ID 规范化：在 normalizeId 基础上把版本号统一成点号。
 * "claude-sonnet-4-5" 和 "claude-sonnet-4.5" → "claude-sonnet-4.5"；
 * "claude-3-5-sonnet" → "claude-3.5-sonnet"。
 * 只合并两侧都是单个数字的段，避免误伤日期（2024-08-06）和参数量（qwen-2-72b）。
 */
export function normalizeModelId(name: string): string {
  return normalizeId(name).replace(/(^|-)(\d)-(\d)(?=-|$)/g, "$1$2.$3");
}

export function makeModelSlug(vendor: string, model: string): string {
  return `${vendor}/${model}`;
}

export function makeOfferingId(platform: string, vendor: string, model: string): string {
  return `${platform}:${makeModelSlug(vendor, model)}`;
}

export interface ParsedOfferingId {
  readonly platform: string;
  readonly vendor: string;
  readonly model: string;
}

export function parseOfferingId(id: string): ParsedOfferingId | null {
  const match = /^([a-z0-9.-]+):([a-z0-9.-]+)\/([a-z0-9.-]+)$/.exec(id);
  if (!match) return null;
  const [, platform, vendor, model] = match;
  if (!platform || !vendor || !model) return null;
  return { platform, vendor, model };
}
