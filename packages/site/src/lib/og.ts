/**
 * 分享卡片图（DEV §3.21）：构建时用 satori 把卡片排成 SVG，再用 resvg 转成 1200×630 PNG。
 * 微信以外的大多数平台（飞书、Telegram、X、Slack）只认 PNG/JPG，不认 SVG。
 * 字体是 Noto Sans SC 粗体子集（常用 3755 个汉字 + ASCII，assets/fonts/），中英文都能排。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { compareColumns } from "./compare";
import { t } from "./i18n";
import { DEFAULT_CURRENCY, type Locale } from "./locale";
import { formatPrice, formatTokens } from "./shared-client";
import type { TableRow } from "./table";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const FONT_FILE = "assets/fonts/noto-sans-sc-700-og.woff";

let font: Buffer | null = null;
function loadFont(): Buffer {
  if (font) return font;
  // 源码直接运行（测试）时按本文件位置找；astro build 打包后 import.meta.url 会变，再按 cwd（packages/site）找
  const candidates = [
    fileURLToPath(new URL(`../../${FONT_FILE}`, import.meta.url)),
    join(process.cwd(), FONT_FILE),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`找不到分享图字体：${candidates.join("、")}`);
  font = readFileSync(path);
  return font;
}

/** satori 的元素结构（不用 JSX，避免 .ts 文件里引入 React 运行时） */
interface Node {
  readonly type: string;
  readonly props: { readonly style?: Record<string, unknown>; readonly children?: unknown };
}

function el(style: Record<string, unknown>, children?: unknown): Node {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

export interface OgModelCard {
  readonly displayName: string;
  readonly vendorName: string;
  /** 例如「¥0.100 / ¥0.400」 */
  readonly price: string;
  /** 例如「最低价来自 DeepInfra · 共 5 个平台 · 上下文 128K」 */
  readonly detail: string;
}

/** 由某个模型的全部报价生成卡片文字；没有报价时返回 null */
export function ogModelCard(
  rows: readonly TableRow[],
  slug: string,
  locale: Locale,
): OgModelCard | null {
  const column = compareColumns(rows, [slug]).columns[0];
  if (!column) return null;
  const currency = DEFAULT_CURRENCY[locale];
  const { best } = column;
  const pick = (index: 0 | 1): string => {
    const value = currency === "USD" ? best.usd[index] : best.cny[index];
    return formatPrice(value, currency, { locale, approx: currency !== best.currency });
  };
  const parts = [
    t(locale, "og.cheapestFrom", { platform: best.platformName }),
    t(locale, "og.platforms", { count: column.platformCount }),
    ...(column.contextWindow === null
      ? []
      : [t(locale, "og.context", { context: formatTokens(column.contextWindow) })]),
  ];
  return {
    displayName: column.displayName,
    vendorName: column.vendorName,
    price: `${pick(0)} / ${pick(1)}`,
    detail: parts.join(" · "),
  };
}

const PAD_X = 72;
const PAD_Y = 64;
const COLORS = { bg: "#0b0d10", text: "#f5f7fa", muted: "#9aa4b2", accent: "#60a5fa" };

function frame(locale: Locale, host: string, body: readonly Node[]): Node {
  return el(
    {
      // satori 的 width/height 不含内边距，所以要减掉
      width: OG_WIDTH - PAD_X * 2,
      height: OG_HEIGHT - PAD_Y * 2,
      flexDirection: "column",
      justifyContent: "space-between",
      padding: `${PAD_Y}px ${PAD_X}px`,
      backgroundColor: COLORS.bg,
      color: COLORS.text,
      fontFamily: "Noto Sans SC",
    },
    [
      el({ alignItems: "center", gap: 16, fontSize: 30, color: COLORS.accent }, [
        el({ width: 18, height: 18, borderRadius: 4, backgroundColor: COLORS.accent }),
        t(locale, "site.name"),
      ]),
      el({ flexDirection: "column", gap: 20 }, body),
      el({ fontSize: 24, color: COLORS.muted }, t(locale, "og.footer", { host })),
    ],
  );
}

/** host：页脚显示的站点地址，例如 mypicko.github.io/ai-api-price */
export function modelCardNode(card: OgModelCard, locale: Locale, host: string): Node {
  return frame(locale, host, [
    el({ fontSize: 32, color: COLORS.muted }, card.vendorName),
    el({ fontSize: card.displayName.length > 28 ? 56 : 72, lineHeight: 1.1 }, card.displayName),
    el({ alignItems: "baseline", gap: 18, marginTop: 12 }, [
      el({ fontSize: 60, color: COLORS.accent }, card.price),
      el({ fontSize: 26, color: COLORS.muted }, t(locale, "og.unit")),
    ]),
    el({ fontSize: 28, color: COLORS.muted }, card.detail),
  ]);
}

export function siteCardNode(locale: Locale, host: string, stats: string): Node {
  return frame(locale, host, [
    el({ fontSize: 72, lineHeight: 1.1 }, t(locale, "site.tagline")),
    el({ fontSize: 32, color: COLORS.muted }, stats),
  ]);
}

export async function renderPng(node: Node): Promise<Uint8Array> {
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [{ name: "Noto Sans SC", data: loadFont(), weight: 700, style: "normal" }],
  });
  // satori 已把文字转成路径，不需要系统字体；默认每次都扫描系统字体，单张要 1～2 秒
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

export function pngResponse(png: Uint8Array): Response {
  return new Response(new Blob([new Uint8Array(png)]), {
    headers: { "Content-Type": "image/png" },
  });
}
