/**
 * RSS 2.0（API 文档 §2.8）：最近 100 条事件，不包括 context_change。
 */
import type { ChangeEvent, ChangeField } from "@aipb/shared";
import { createT, type MessageKey } from "./i18n";
import type { Locale } from "./locale";
import { formatPct, formatPrice, formatTokens } from "./shared-client";
import { absoluteUrl, joinBase, localePath, modelPath } from "./url";
import { el, textEl, xmlDocument, type XmlElement } from "./xml";

export const RSS_LIMIT = 100;

const TYPE_EMOJI: Readonly<Record<ChangeEvent["type"], string>> = {
  price_down: "🔻",
  price_up: "🔺",
  new_model: "🆕",
  removed: "⛔",
  restored: "♻️",
  context_change: "↔️",
};

export interface RssContext {
  readonly locale: Locale;
  /** 例如 https://alice.github.io */
  readonly site: string;
  readonly base: string;
  readonly generatedAt: string;
  readonly platformName: (id: string) => string;
  /** new_model 标题需要当前价格 */
  readonly currentPrices: (
    offeringId: string,
  ) => { input: number | null; output: number | null } | null;
  /** 单个模型的订阅源：覆盖频道标题和链接 */
  readonly channelTitle?: string;
  readonly channelLink?: string;
}

/** ¥16.00 → ¥16，$0.150 → $0.15（标题用紧凑写法，描述用完整写法） */
export function compactPrice(text: string): string {
  return text.replace(/(\d)\.(\d*?)0+(?!\d)/g, (_, int: string, frac: string) =>
    frac ? `${int}.${frac}` : int,
  );
}

function fieldValue(
  field: ChangeField,
  value: number | null,
  event: ChangeEvent,
  locale: Locale,
): string {
  if (field.field === "contextWindow") return formatTokens(value);
  return formatPrice(value, event.currency, { locale });
}

export function rssTitle(event: ChangeEvent, ctx: RssContext): string {
  const t = createT(ctx.locale);
  const name = event.displayName;
  const platform = ctx.platformName(event.platform);
  const emoji = TYPE_EMOJI[event.type];
  if (event.type === "new_model") {
    const prices = ctx.currentPrices(event.offeringId);
    const fmt = (v: number | null | undefined): string =>
      compactPrice(formatPrice(v ?? null, event.currency, { locale: ctx.locale }));
    return `${emoji} ${t("rss.new", { name, platform, input: fmt(prices?.input), output: fmt(prices?.output) })}`;
  }
  if (event.type === "removed") return `${emoji} ${t("rss.removed", { name, platform })}`;
  if (event.type === "restored") return `${emoji} ${t("rss.restored", { name, platform })}`;
  const fields = event.fields
    .map((f) =>
      t("rss.field", {
        field: t(`change.field.${f.field}` as MessageKey),
        old: compactPrice(fieldValue(f, f.old, event, ctx.locale)),
        new: compactPrice(fieldValue(f, f.new, event, ctx.locale)),
        pct: formatPct(f.pct),
      }),
    )
    .join(t("rss.fieldSeparator"));
  return `${emoji} ${t("rss.price", { name, platform, fields })}`;
}

export function rssDescription(event: ChangeEvent, ctx: RssContext): string {
  const t = createT(ctx.locale);
  if (event.fields.length === 0) return rssTitle(event, ctx).replace(/^\S+\s/, "");
  const body = event.fields
    .map((f) =>
      t("rss.descField", {
        field: t(`rss.short.${f.field}` as MessageKey),
        old: fieldValue(f, f.old, event, ctx.locale),
        new: fieldValue(f, f.new, event, ctx.locale),
      }),
    )
    .join(t("rss.fieldSeparator"));
  return t("rss.perMillion", { body });
}

export function selectRssEvents(events: readonly ChangeEvent[]): readonly ChangeEvent[] {
  return events
    .filter((e) => e.type !== "context_change")
    .toSorted((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id))
    .slice(0, RSS_LIMIT);
}

function rssItem(event: ChangeEvent, ctx: RssContext): XmlElement {
  const link = absoluteUrl(
    ctx.site,
    joinBase(ctx.base, localePath(ctx.locale, modelPath(event.modelSlug))),
  );
  return el("item", {}, [
    textEl("title", rssTitle(event, ctx)),
    textEl("link", link),
    textEl("guid", event.id, { isPermaLink: "false" }),
    textEl("pubDate", new Date(event.detectedAt).toUTCString()),
    textEl("category", event.type),
    textEl("description", rssDescription(event, ctx)),
  ]);
}

export function buildRss(events: readonly ChangeEvent[], ctx: RssContext): string {
  const t = createT(ctx.locale);
  const home = absoluteUrl(ctx.site, joinBase(ctx.base, localePath(ctx.locale)));
  const channel = el("channel", {}, [
    textEl("title", ctx.channelTitle ?? t("rss.title")),
    textEl("link", ctx.channelLink ?? home),
    textEl("description", t("rss.description")),
    textEl("language", ctx.locale === "zh" ? "zh-cn" : "en"),
    textEl("lastBuildDate", new Date(ctx.generatedAt).toUTCString()),
    ...selectRssEvents(events).map((e) => rssItem(e, ctx)),
  ]);
  return xmlDocument(el("rss", { version: "2.0" }, [channel]));
}
