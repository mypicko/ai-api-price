import { normalizeBase } from "./url";

/**
 * 搜索引擎站点验证（DEV §3.21）：在 Google Search Console / 百度搜索资源平台选择「HTML 标签」验证方式，
 * 把 content 值设成仓库变量 GOOGLE_SITE_VERIFICATION / BAIDU_SITE_VERIFICATION，构建时写进 <head>。
 * 这两个值本身是公开的（会出现在网页源码里），不是密钥。
 */
export interface VerificationMeta {
  readonly name: string;
  readonly content: string;
}

const TOKEN = /^[\w-]{1,128}$/;

const ENGINES = [
  { env: "GOOGLE_SITE_VERIFICATION", name: "google-site-verification" },
  { env: "BAIDU_SITE_VERIFICATION", name: "baidu-site-verification" },
] as const;

/** 只接受字母、数字、下划线和连字符，格式不对的值直接忽略 */
export function siteVerificationMeta(
  env: Readonly<Record<string, string | undefined>>,
): readonly VerificationMeta[] {
  return ENGINES.flatMap(({ env: key, name }) => {
    const value = env[key]?.trim();
    return value && TOKEN.test(value) ? [{ name, content: value }] : [];
  });
}

/**
 * ICP 备案号（国内站，DEV §3.27）：大陆服务器上的网站要在页脚显示备案号并链接到工信部备案系统。
 * 只在国内站构建时设置 ICP_BEIAN（如「豫ICP备2026013506号-1」）；海外镜像 GitHub Pages 不设置，不显示。
 */
export const BEIAN_URL = "https://beian.miit.gov.cn/";

const BEIAN = /^[一-龥]{1,2}ICP备\d{6,12}号(-\d{1,3})?$/;

export function icpBeian(
  env: Readonly<Record<string, string | undefined>>,
): { readonly text: string; readonly url: string } | null {
  const value = env["ICP_BEIAN"]?.trim() ?? "";
  return BEIAN.test(value) ? { text: value, url: BEIAN_URL } : null;
}

/**
 * canonical 主站（DEV §3.28）：国内站 promptso.top 和海外镜像 GitHub Pages 内容相同，
 * 镜像构建时设置 CANONICAL_URL=https://promptso.top，让 canonical / hreflang / og:url 都指向主站，
 * 避免搜索引擎当成重复站分散权重。没设置或不是 https 地址时用本站自己的域名和 base。
 */
export interface CanonicalSite {
  readonly origin: string;
  readonly base: string;
}

export function canonicalSite(
  env: Readonly<Record<string, string | undefined>>,
  fallback: CanonicalSite,
): CanonicalSite {
  const value = env["CANONICAL_URL"]?.trim() ?? "";
  if (!/^https:\/\/[^/\s]+/.test(value)) return fallback;
  try {
    const url = new URL(value);
    return { origin: url.origin, base: normalizeBase(url.pathname) };
  } catch {
    return fallback;
  }
}
