/**
 * 转售平台的模型路径 → 研发厂商（vendorHint）+ 模型名。
 * 各平台写法不同：Bedrock「us.anthropic.claude-…-v1:0」、Vertex「claude-…@20241022」、
 * Fireworks「accounts/fireworks/models/…」、Hugging Face 风格「deepseek-ai/DeepSeek-V3」等。
 * 模型名只做平台相关的清洗，统一大小写和版本号写法交给 normalize（normalizeModelId）。
 *
 * 只认识主流厂商；推断不出厂商的（社区微调、按参数量分档的伪条目）返回 null，由调用方跳过。
 */

/** Hugging Face 风格的组织名 / Bedrock 的厂商前缀 → vendorHint（需与 providers.yaml 的 matchers 对应） */
const ORG_VENDORS: Readonly<Record<string, string>> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "meta-llama": "meta",
  meta: "meta",
  mistralai: "mistral",
  mistral: "mistral",
  "deepseek-ai": "deepseek",
  deepseek: "deepseek",
  qwen: "alibaba",
  alibaba: "alibaba",
  "zai-org": "zhipu",
  "z-ai": "zhipu",
  thudm: "zhipu",
  minimaxai: "minimax",
  minimax: "minimax",
  moonshotai: "moonshot",
  nvidia: "nvidia",
  microsoft: "microsoft",
  "x-ai": "x-ai",
  xai: "x-ai",
  cohere: "cohere",
  amazon: "amazon",
  bytedance: "bytedance",
  "bytedance-seed": "bytedance",
  tencent: "tencent",
  baidu: "baidu",
};

/** 模型系列前缀 → vendorHint；按顺序匹配，较具体的放前面（nemotron 先于 llama） */
const FAMILY_VENDORS: readonly (readonly [RegExp, string])[] = [
  [/nemotron/, "nvidia"],
  [/^claude/, "anthropic"],
  [/^(gpt|o[134](-|$)|chatgpt|codex)/, "openai"],
  [/^(gemini|gemma)/, "google"],
  [/^(llama|meta-llama)/, "meta"],
  [/^(mistral|mixtral|codestral|ministral|magistral|devstral|pixtral)/, "mistral"],
  [/^deepseek/, "deepseek"],
  [/^(qwen|qwq)/, "alibaba"],
  [/^(glm|chatglm)/, "zhipu"],
  [/^kimi/, "moonshot"],
  [/^minimax/, "minimax"],
  [/^grok/, "x-ai"],
  [/^(command|c4ai)/, "cohere"],
  [/^nova-/, "amazon"],
  [/^phi-/, "microsoft"],
  [/^(ernie)/, "baidu"],
  [/^(doubao|seed-)/, "bytedance"],
  [/^hunyuan/, "tencent"],
];

/** Bedrock 的跨区域推理前缀 */
const REGION_PREFIX = /^(us|eu|apac|global|us-gov|jp|au|ca|apne1|apse2)\./;
/** 平台自带的路径前缀，不含厂商信息 */
const PLATFORM_PATH = /^(accounts\/[^/]+\/models\/|@cf\/|@hf\/|databricks-)/;

function stripPlatformNoise(path: string): string {
  return path
    .replace(REGION_PREFIX, "")
    .replace(/^(eu|us|global)\//, "")
    .replace(PLATFORM_PATH, "");
}

interface SplitPath {
  readonly org: string | null;
  readonly rest: string;
  /** Bedrock 风格（「厂商.模型」），只有这种写法带 -v1 / -v1:0 版本后缀 */
  readonly bedrockStyle: boolean;
}

/** 「anthropic.claude-…」→ anthropic + claude-…；「deepseek-ai/DeepSeek-V3」→ deepseek-ai + DeepSeek-V3 */
function splitOrg(path: string): SplitPath {
  const cleaned = stripPlatformNoise(path);
  const slash = cleaned.lastIndexOf("/");
  if (slash >= 0) {
    const org = cleaned.slice(0, slash).split("/").at(-1) ?? null;
    return { org, rest: cleaned.slice(slash + 1), bedrockStyle: false };
  }
  const dot = /^([a-z0-9-]+)\.(.+)$/.exec(cleaned);
  if (dot?.[1] && dot[2] && ORG_VENDORS[dot[1]] !== undefined)
    return { org: dot[1], rest: dot[2], bedrockStyle: true };
  return { org: null, rest: cleaned, bedrockStyle: false };
}

export function inferVendorHint(path: string): string | null {
  const { org, rest } = splitOrg(path);
  const name = rest.toLowerCase();
  const family = FAMILY_VENDORS.find(([pattern]) => pattern.test(name))?.[1];
  // 组织名明确时以组织为准（openai/gpt-oss、nvidia/Llama-…-Nemotron 除外由 family 覆盖）
  const byOrg = org === null ? undefined : ORG_VENDORS[org.toLowerCase()];
  if (family === "nvidia") return family;
  return byOrg ?? family ?? null;
}

/**
 * 平台相关的清洗：去掉区域/路径前缀、Bedrock 的 -v1 / -v1:0 版本后缀，Vertex 的 @日期 改成 -日期，
 * 以及 Vertex 的 -maas 标记；Llama 统一成「llama-3.1-…」写法（Bedrock「llama3-1」、Cerebras「llama3.1」、
 * Databricks「meta-llama-3.1」），版本号的点号由 normalizeModelId 统一。量化标记（-fp8 等）保留。
 */
export function resellerModelName(path: string): string {
  const { rest, bedrockStyle } = splitOrg(path);
  const version = bedrockStyle ? /-v\d+(:\d+)?$/ : /-v\d+:\d+$/;
  return rest
    .replace(version, "")
    .replace(/@/, "-")
    .replace(/-maas$/i, "")
    .replace(/^meta-(?=llama)/i, "")
    .replace(/^llama(\d)/i, "llama-$1");
}
