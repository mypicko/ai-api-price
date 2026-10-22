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
