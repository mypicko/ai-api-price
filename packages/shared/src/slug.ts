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

/**
 * 各平台写法差异的统一（DEV §3.23），在 normalizeModelId 之后执行，输入输出都是规范 ID，可重复执行（幂等）。
 * 同一个模型在不同来源写法不同，会被拆成多行，所以统一成主流写法：
 * - 「厂商.模型」前缀（Bedrock 风格）：模型名以厂商名开头时去掉前缀（qwen.qwen3-… → qwen3-…，
 *   mistral.mixtral-… → mixtral-…，nvidia.nemotron-… → nemotron-…），否则点号改成横线（deepseek.v3.2 → deepseek-v3.2）
 * - Fireworks 用 p 表示小数点：qwen2p5 → qwen2.5，glm-4p5v → glm-4.5v，v1p5 → v1.5
 * - v4-1 → v4.1（deepseek-v4-1-flash → deepseek-v4.1-flash）
 * - llama-v3 → llama-3；qwen-2.5 / qwen-v2.5 → qwen2.5；qwen25 → qwen2.5
 * - Azure 的 gpt-35 → gpt-3.5；grok-4-20 → grok-4.20（两位小版本，normalizeModelId 不合并）
 * - NVIDIA 模型去掉重复的 nvidia- 前缀：nvidia-nemotron-nano-9b-v2 → nemotron-nano-9b-v2
 */
/** 「厂商.模型」里模型名不以厂商名开头、但属于该厂商的系列 */
const VENDOR_FAMILIES: Readonly<Record<string, RegExp>> = {
  mistral: /^(mistral|mixtral|codestral|ministral|magistral|devstral|pixtral|voxtral)/,
  amazon: /^(nova|titan)-/,
  anthropic: /^claude/,
  meta: /^llama/,
  cohere: /^(command|embed-|rerank-)/,
  nvidia: /^nemotron/,
};

function stripVendorDot(id: string): string {
  const match = /^([a-z]+)\.(?=[a-z])(.*)$/.exec(id);
  if (!match) return id;
  const [, prefix = "", rest = ""] = match;
  const sameFamily = rest.startsWith(prefix) || (VENDOR_FAMILIES[prefix]?.test(rest) ?? false);
  return sameFamily ? rest : `${prefix}-${rest}`;
}

export function canonicalModelId(id: string): string {
  return stripVendorDot(id)
    .replace(/(\d)p(\d)/g, "$1.$2")
    .replace(/(^|-)v(\d)-(\d)(?=-|$)/g, "$1v$2.$3")
    .replace(/^llama-v(\d)/, "llama-$1")
    .replace(/^qwen-v?(\d)/, "qwen$1")
    .replace(/^qwen(\d)(\d)(?=-|$)/, "qwen$1.$2")
    .replace(/^gpt-35(?=-|$)/, "gpt-3.5")
    .replace(/^grok-(\d)-(\d{2})(?=-|$)/, "grok-$1.$2")
    .replace(/^nvidia-(?=nemotron)/, "");
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
