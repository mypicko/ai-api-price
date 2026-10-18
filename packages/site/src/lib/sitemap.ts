/** sitemap.xml：每个页面列出中英文两个版本，并用 xhtml:link 标注 hreflang */
import { HTML_LANG, LOCALES } from "./locale";
import { absoluteUrl, joinBase, localePath } from "./url";
import { el, textEl, xmlDocument } from "./xml";

export function buildSitemap(
  site: string,
  base: string,
  paths: readonly string[],
  lastmod: string,
): string {
  const href = (locale: (typeof LOCALES)[number], path: string): string =>
    absoluteUrl(site, joinBase(base, localePath(locale, path)));
  const urls = paths.flatMap((path) =>
    LOCALES.map((locale) =>
      el("url", {}, [
        textEl("loc", href(locale, path)),
        textEl("lastmod", lastmod.slice(0, 10)),
        ...LOCALES.map((alt) =>
          el("xhtml:link", { rel: "alternate", hreflang: HTML_LANG[alt], href: href(alt, path) }),
        ),
        el("xhtml:link", { rel: "alternate", hreflang: "x-default", href: href("zh", path) }),
      ]),
    ),
  );
  return xmlDocument(
    el(
      "urlset",
      {
        xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
        "xmlns:xhtml": "http://www.w3.org/1999/xhtml",
      },
      urls,
    ),
  );
}
