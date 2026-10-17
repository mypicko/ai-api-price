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
