/**
 * 路径工具：所有内部链接都要带 base 前缀（GitHub Pages 子路径部署）。
 */
import type { Locale } from "./locale";

/** undefined / "" / "ai-api-price" / "/ai-api-price" → "/" 或 "/ai-api-price/" */
export function normalizeBase(base: string | undefined): string {
  const trimmed = (base ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/** joinBase("/x/", "/models/a/b/") → "/x/models/a/b/" */
export function joinBase(base: string, path: string): string {
  const normalized = normalizeBase(base);
  const clean = path.replace(/^\/+/, "");
  return `${normalized}${clean}`;
}

/** 站内页面路径（不含 base），中文无前缀，英文前缀 en/；页面路径统一以 / 结尾 */
export function localePath(locale: Locale, path = ""): string {
  const clean = path.replace(/^\/+/, "");
  const withSlash =
    clean === "" || clean.endsWith("/") || /\.[a-z]+$/.test(clean) ? clean : `${clean}/`;
  return locale === "en" ? `/en/${withSlash}` : `/${withSlash}`;
}

/** 带 base 的页面链接 */
export function pageHref(base: string, locale: Locale, path = ""): string {
  return joinBase(base, localePath(locale, path));
}

export function modelPath(modelSlug: string): string {
  return `models/${modelSlug}/`;
}

/** 把当前页面路径（含 base）去掉 base 和 en/ 前缀，得到与语言无关的路径 */
export function stripLocale(pathname: string, base: string): string {
  const normalized = normalizeBase(base);
  const withoutBase = pathname.startsWith(normalized)
    ? pathname.slice(normalized.length)
    : pathname.replace(/^\/+/, "");
  if (withoutBase === "en") return "";
  return withoutBase.startsWith("en/") ? withoutBase.slice(3) : withoutBase;
}

/** 绝对 URL：site 可以带或不带结尾斜杠 */
export function absoluteUrl(site: string, path: string): string {
  return `${site.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
