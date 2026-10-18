/**
 * 可选的访问统计（默认关闭）。只支持不使用 Cookie 的服务：
 * - cloudflare：Cloudflare Web Analytics，ANALYTICS_TOKEN = beacon token（32 位十六进制）
 * - umami：Umami，ANALYTICS_TOKEN = website id（UUID）；ANALYTICS_SCRIPT_URL 可指向自建实例
 * 这些值会出现在公开页面里，不是密钥，放在 GitHub Variables 即可。
 * 统计脚本的域名会精确加入 CSP 白名单（安全项 S12），其余第三方脚本仍被拦截。
 */

export type AnalyticsConfig =
  | { readonly provider: "cloudflare"; readonly token: string }
  | { readonly provider: "umami"; readonly websiteId: string; readonly scriptUrl: string };

export interface AnalyticsScript {
  readonly src: string;
  readonly attrs: Readonly<Record<string, string>>;
}

export interface AnalyticsCspSources {
  readonly script: readonly string[];
  readonly connect: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

const CLOUDFLARE_SCRIPT = "https://static.cloudflareinsights.com/beacon.min.js";
const CLOUDFLARE_COLLECT = "https://cloudflareinsights.com";
const UMAMI_CLOUD_SCRIPT = "https://cloud.umami.is/script.js";
/** Umami 云版的数据上报网关 */
const UMAMI_CLOUD_GATEWAY = "https://api-gateway.umami.dev";

const CLOUDFLARE_TOKEN = /^[a-f0-9]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireMatch(
  value: string | undefined,
  pattern: RegExp,
  name: string,
  hint: string,
): string {
  const trimmed = value?.trim() ?? "";
  if (!pattern.test(trimmed)) throw new Error(`${name} 格式不正确：应为${hint}`);
  return trimmed;
}

function parseScriptUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (raw === "") return UMAMI_CLOUD_SCRIPT;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ANALYTICS_SCRIPT_URL 不是合法的网址");
  }
  if (url.protocol !== "https:") throw new Error("ANALYTICS_SCRIPT_URL 必须是 https 地址");
  return url.href;
}

/** 读取环境变量；未设置返回 null，设置了但不合法直接抛错（构建失败比悄悄失效好） */
export function parseAnalyticsConfig(env: Env): AnalyticsConfig | null {
  const provider = env["ANALYTICS_PROVIDER"]?.trim() ?? "";
  if (provider === "") return null;
  if (provider === "cloudflare") {
    const token = requireMatch(
      env["ANALYTICS_TOKEN"],
      CLOUDFLARE_TOKEN,
      "ANALYTICS_TOKEN",
      " 32 位十六进制 token",
    );
    return { provider, token };
  }
  if (provider === "umami") {
    const websiteId = requireMatch(
      env["ANALYTICS_TOKEN"],
      UUID,
      "ANALYTICS_TOKEN",
      " Umami 网站 ID（UUID）",
    );
    return { provider, websiteId, scriptUrl: parseScriptUrl(env["ANALYTICS_SCRIPT_URL"]) };
  }
  throw new Error(`ANALYTICS_PROVIDER 只支持 cloudflare 或 umami，收到：${provider}`);
}

export function analyticsScript(config: AnalyticsConfig | null): AnalyticsScript | null {
  if (!config) return null;
  if (config.provider === "cloudflare") {
    return {
      src: CLOUDFLARE_SCRIPT,
      attrs: { "data-cf-beacon": JSON.stringify({ token: config.token }) },
    };
  }
  return { src: config.scriptUrl, attrs: { "data-website-id": config.websiteId } };
}

export function analyticsCspSources(config: AnalyticsConfig | null): AnalyticsCspSources {
  if (!config) return { script: [], connect: [] };
  if (config.provider === "cloudflare") {
    return { script: [new URL(CLOUDFLARE_SCRIPT).origin], connect: [CLOUDFLARE_COLLECT] };
  }
  const origin = new URL(config.scriptUrl).origin;
  const isCloud = config.scriptUrl === UMAMI_CLOUD_SCRIPT;
  return { script: [origin], connect: isCloud ? [origin, UMAMI_CLOUD_GATEWAY] : [origin] };
}
