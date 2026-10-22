/** RSS / sitemap / robots 的静态端点实现（页面文件只负责转发） */
import type { Locale } from "./locale";
import { buildRss } from "./rss";
import { getSiteModel } from "./site-data";
import { t } from "./i18n";
import { platformName, type ModelInfo, type SiteModel } from "./site-model";
import { buildSitemap } from "./sitemap";
import { absoluteUrl, joinBase, modelPath, normalizeBase, pageHref } from "./url";

const DEFAULT_SITE = "http://localhost:4321";

function siteOrigin(site: URL | undefined): string {
  return (site ?? new URL(DEFAULT_SITE)).origin;
}

function currentBase(): string {
  return normalizeBase(import.meta.env?.BASE_URL ?? process.env["BASE_PATH"]);
}

export function rssXml(model: SiteModel, locale: Locale, site: string, base: string): string {
  return buildRss(model.events, {
    locale,
    site,
    base,
    generatedAt: model.generatedAt,
    platformName: (id) => platformName(model, id, locale),
    currentPrices: (id) => model.offeringsById.get(id) ?? null,
  });
}

/** 模型订阅源相对路径（不含 base、不含语言前缀）：models/vendor/model/rss.xml */
export function modelRssPath(slug: string): string {
  return `${modelPath(slug)}rss.xml`;
}

/** 单个模型的价格变动订阅源 */
export function modelRssXml(
  model: SiteModel,
  info: ModelInfo,
  locale: Locale,
  site: string,
  base: string,
): string {
  return buildRss(
    model.events.filter((e) => e.modelSlug === info.slug),
    {
      locale,
      site,
      base,
      generatedAt: model.generatedAt,
      platformName: (id) => platformName(model, id, locale),
      currentPrices: (id) => model.offeringsById.get(id) ?? null,
      channelTitle: t(locale, "rss.modelTitle", { name: info.displayName }),
      channelLink: absoluteUrl(site, pageHref(base, locale, modelPath(info.slug))),
    },
  );
}

export function modelRssResponse(info: ModelInfo, locale: Locale, site: URL | undefined): Response {
  const xml = modelRssXml(getSiteModel(), info, locale, siteOrigin(site), currentBase());
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

export function rssResponse(locale: Locale, site: URL | undefined): Response {
  const xml = rssXml(getSiteModel(), locale, siteOrigin(site), currentBase());
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

/** media/ 已并入首页价格榜标签，只保留跳转页，不进 sitemap */
export const STATIC_PAGES = ["", "calculator/", "changes/", "about/"] as const;

export function sitemapPaths(model: SiteModel): readonly string[] {
  return [...STATIC_PAGES, ...model.models.map((m) => modelPath(m.slug))];
}

export function sitemapResponse(site: URL | undefined): Response {
  const model = getSiteModel();
  const xml = buildSitemap(siteOrigin(site), currentBase(), sitemapPaths(model), model.generatedAt);
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

export function robotsResponse(site: URL | undefined): Response {
  const sitemap = absoluteUrl(siteOrigin(site), joinBase(currentBase(), "sitemap.xml"));
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
