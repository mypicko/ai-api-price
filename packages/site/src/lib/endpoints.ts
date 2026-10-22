/** RSS / sitemap / robots 的静态端点实现（页面文件只负责转发） */
import type { Locale } from "./locale";
import { boardData, boardTableRows } from "./board-data";
import { modelCardNode, ogModelCard, pngResponse, renderPng, siteCardNode } from "./og";
import type { TableRow } from "./table";
import { buildRss } from "./rss";
import { getSiteModel } from "./site-data";
import { t } from "./i18n";
import { platformName, vendorName, type ModelInfo, type SiteModel } from "./site-model";
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

/** 首页价格榜全量数据（不缩进，减小体积） */
export function boardDataResponse(locale: Locale): Response {
  return new Response(JSON.stringify(boardData(getSiteModel(), locale)), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** 卡片页脚显示的站点地址：去掉协议和末尾斜杠 */
function displayHost(site: URL | undefined): string {
  return absoluteUrl(siteOrigin(site), joinBase(currentBase(), ""))
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

const tableRowsCache = new Map<Locale, readonly TableRow[]>();
function tableRows(locale: Locale): readonly TableRow[] {
  const cached = tableRowsCache.get(locale);
  if (cached) return cached;
  const rows = boardTableRows(getSiteModel(), locale);
  tableRowsCache.set(locale, rows);
  return rows;
}

export async function modelOgResponse(
  info: ModelInfo,
  locale: Locale,
  site: URL | undefined,
): Promise<Response> {
  const card = ogModelCard(tableRows(locale), info.slug, locale) ?? {
    displayName: info.displayName,
    vendorName: vendorName(getSiteModel(), info.vendor, locale),
    price: "—",
    detail: "",
  };
  return pngResponse(await renderPng(modelCardNode(card, locale, displayHost(site))));
}

export async function siteOgResponse(locale: Locale, site: URL | undefined): Promise<Response> {
  const rows = tableRows(locale);
  const stats = t(locale, "og.siteStats", {
    models: new Set(rows.map((r) => r.modelSlug)).size,
    count: rows.length,
    platforms: new Set(rows.map((r) => r.platform)).size,
  });
  return pngResponse(await renderPng(siteCardNode(locale, displayHost(site), stats)));
}
