/** RSS / sitemap / robots 的静态端点实现（页面文件只负责转发） */
import type { Locale } from "./locale";
import { buildRss } from "./rss";
import { getSiteModel } from "./site-data";
import { platformName, type SiteModel } from "./site-model";
import { buildSitemap } from "./sitemap";
import { absoluteUrl, joinBase, modelPath, normalizeBase } from "./url";

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

export function rssResponse(locale: Locale, site: URL | undefined): Response {
  const xml = rssXml(getSiteModel(), locale, siteOrigin(site), currentBase());
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}

export const STATIC_PAGES = ["", "calculator/", "media/", "changes/", "about/"] as const;

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
