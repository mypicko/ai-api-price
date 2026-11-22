/**
 * MiniMax 国内站人民币价格（Mintlify 文档站，静态 HTML，服务端渲染）。
 * 入口：https://platform.minimax.cn/docs/pricing/overview
 *   （platform.minimaxi.com/docs/guides/pricing 等旧地址都跳转到这里）。原来国内价只有 models.dev 社区数据（美元换算），
 *   现在以本抓取器为准（优先级更高），models.dev 只补本页没有的旧模型（M2 系列等）。
 * 结构要点：
 * - 「语言模型」下有几张表，表头「模型 | 输入价格 元/百万 tokens | 输出价格 | 缓存读取」；视频 / 图片 / 语音表表头不同，自动跳过
 * - MiniMax-M3 的表放在「标准 / 优先*」两个标签页里（role="tabpanel"，aria-labelledby 是 URL 编码的标签名），
 *   优先服务按标准价 1.5 倍计费，不收
 * - 模型格：「<strong>MiniMax-M3</strong><br/>≤ 512k 输入 tokens <span>永久五折</span>」，同一模型多行 = 按输入长度分档
 * - 价格格：「<del>4.20</del> 2.10」= 原价 4.20、折后 2.10。「永久五折」是长期实际扣费价，记折后价，原价写进 notes
 * 最后核对：2026-11-22
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import { type HtmlElement, joinNotes, normalizeSpace } from "./parse-price";
import type { Source } from "./types";

export const MINIMAX_CN_URL = "https://platform.minimax.cn/docs/pricing/overview";
const SOURCE_ID = "minimax-cn";
const PRIORITY_TAB = /优先/;
const NUMBER = /^\d+(?:\.\d+)?$/;

interface Price {
  readonly value: number | null;
  readonly original: number | null;
}

interface Row {
  readonly model: string;
  readonly range: { readonly min: number; readonly max: number | null } | null;
  readonly discount: string | null;
  readonly input: Price;
  readonly output: Price;
  readonly cacheRead: Price;
}

const toNumber = (text: string): number | null => {
  const clean = normalizeSpace(text);
  return NUMBER.test(clean) ? Number(clean) : null;
};

/** 「<del>4.20</del> 2.10」→ 折后 2.10、原价 4.20；「1.00」→ 1、无原价 */
function priceOf($: cheerio.CheerioAPI, cell: HtmlElement | undefined): Price {
  if (!cell) return { value: null, original: null };
  const copy = $(cell).clone();
  const original = toNumber(copy.find("del, s").text());
  copy.find("del, s").remove();
  return { value: toNumber(copy.text()), original };
}

/** 「≤ 512k 输入 tokens」→ 0~512000；「> 512k 输入 tokens」→ 512000~不限 */
function rangeOf(text: string): Row["range"] {
  const match = /([≤<>≥])\s*(\d+(?:\.\d+)?)\s*k/i.exec(text);
  if (!match?.[1] || !match[2]) return null;
  const tokens = Number(match[2]) * 1000;
  return match[1] === "≤" || match[1] === "<"
    ? { min: 0, max: tokens }
    : { min: tokens, max: null };
}

function parseRow($: cheerio.CheerioAPI, tr: HtmlElement, columns: Columns): Row | null {
  const cells = $(tr).children("td").toArray();
  const nameCell = cells[0];
  if (!nameCell) return null;
  const strong = normalizeSpace($(nameCell).find("strong").first().text());
  const model = strong || (normalizeSpace($(nameCell).text()).split(" ")[0] ?? "");
  if (!/^minimax/i.test(model)) return null;
  const badge = normalizeSpace($(nameCell).find("span").last().text());
  return {
    model,
    range: rangeOf($(nameCell).text()),
    discount: /折/.test(badge) ? badge : null,
    input: priceOf($, cells[columns.input]),
    output: priceOf($, cells[columns.output]),
    cacheRead:
      columns.cacheRead >= 0
        ? priceOf($, cells[columns.cacheRead])
        : { value: null, original: null },
  };
}

interface Columns {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

/** 表头有「输入价格」+「输出价格」才是语言模型表 */
function columnsOf($: cheerio.CheerioAPI, table: HtmlElement): Columns | null {
  const headers = $(table)
    .find("thead th, tr:first-child th")
    .toArray()
    .map((th) => normalizeSpace($(th).text()));
  const input = headers.findIndex((h) => h.startsWith("输入价格"));
  const output = headers.findIndex((h) => h.startsWith("输出价格"));
  if (input < 0 || output < 0 || !/^模型/.test(headers[0] ?? "")) return null;
  return { input, output, cacheRead: headers.findIndex((h) => h.startsWith("缓存读取")) };
}

function inPriorityTab($: cheerio.CheerioAPI, table: HtmlElement): boolean {
  const label = $(table).closest('[role="tabpanel"]').attr("aria-labelledby") ?? "";
  try {
    return PRIORITY_TAB.test(decodeURIComponent(label));
  } catch {
    return PRIORITY_TAB.test(label);
  }
}

function toOffering(rows: readonly Row[]): RawOffering | null {
  const [first] = rows;
  if (!first || (first.input.value === null && first.output.value === null)) return null;
  const tiers: RawTier[] = rows
    .filter((r) => r.range !== null)
    .map((r) => ({
      minInputTokens: r.range?.min ?? 0,
      maxInputTokens: r.range?.max ?? null,
      input: r.input.value,
      output: r.output.value,
    }));
  const notes = first.discount
    ? joinNotes([
        `官方「${first.discount}」，表中为折后价（实际扣费）`,
        `原价：输入 ¥${first.input.original ?? "—"}、输出 ¥${first.output.original ?? "—"}`,
      ])
    : undefined;
  return {
    vendorHint: "minimax",
    modelName: first.model,
    displayName: first.model,
    currency: "CNY",
    unit: "per_1m",
    input: first.input.value,
    output: first.output.value,
    ...(first.cacheRead.value === null ? {} : { cacheRead: first.cacheRead.value }),
    ...(tiers.length > 1 ? { tiers } : {}),
    sourceUrl: MINIMAX_CN_URL,
    ...(notes ? { notes } : {}),
  };
}

export function parseMinimaxCnHtml(html: string): RawOffering[] {
  const $ = cheerio.load(html);
  const groups = new Map<string, Row[]>();
  for (const table of $("table").toArray()) {
    const columns = columnsOf($, table);
    if (!columns || inPriorityTab($, table)) continue;
    for (const tr of $(table).find("tbody tr").toArray()) {
      const row = parseRow($, tr, columns);
      if (row) groups.set(row.model, [...(groups.get(row.model) ?? []), row]);
    }
  }
  const offerings = [...groups.values()].flatMap((rows) => {
    const offering = toOffering(rows);
    return offering ? [offering] : [];
  });
  if (offerings.length === 0)
    throw new PipelineError("E2001", "minimax-cn：找不到语言模型价格表", { sourceId: SOURCE_ID });
  return offerings;
}

export const minimaxCnSource: Source = {
  id: SOURCE_ID,
  platform: "official-cn",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(MINIMAX_CN_URL, { timeoutMs: 30_000 });
    const offerings = parseMinimaxCnHtml(html);
    ctx.logger.info("minimax-cn 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
