/**
 * 抓取器共享工具（STYLE C3~C6）：
 * - parsePriceText()：价格文本 → { value, currency, unit }，单位和币种只从文字中识别，识别不了就是 null
 * - resolvePrice()：单元格 + 表头上下文 → 完整价格；单位/币种仍然未知时抛 W2003
 * - parseTokenCount() / parseTokenRange()：「128K」「1M」「[32K, 128K)」「0<Token≤256K」
 * - readHtmlTables() / findColumn()：展开 rowspan/colspan，按表头文字定位列
 */
import type { Currency, RawUnit } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";

export interface ParsedPrice {
  /** 0 = 免费 */
  readonly value: number;
  readonly currency: Currency | null;
  readonly unit: RawUnit | null;
}

export interface PriceContext {
  readonly currency?: Currency | null;
  readonly unit?: RawUnit | null;
}

export interface ResolvedPrice {
  readonly value: number;
  readonly currency: Currency;
  readonly unit: RawUnit;
}

/** 明确表示「没有这个价格」的文字 */
const NOT_A_PRICE = /^(?:[-–—/]+|n\/?a|不支持|暂不支持|暂无|无|不适用|not supported|unsupported)$/i;
const FREE = /免费|不计费|^free$/i;
const NUMBER = /(\d[\d,]*(?:\.\d+)?|\.\d+)/;

const CNY = /[¥￥]|(?<![美港日欧澳台])元|人民币|\bCNY\b|\bRMB\b/i;
const USD = /\$|\bUSD\b|美元/i;

const PER_1M = /百万|1\s*M\b|\/\s*M\b|\bM\s*tokens?\b|\bMTok\b|million/i;
const PER_1K = /千\s*tokens?|千token|1\s*K\s*tokens?|\/\s*K\b|\bK\s*tokens?\b|thousand/i;
const PER_TOKEN = /(?:每|\/|per)\s*tokens?\b/i;
/** 不是按 token 计价的单位：遇到就不能当成 token 价格 */
const NON_TOKEN_UNIT =
  /万字符|字符|\/\s*(?:张|次|秒|分钟|小时|页|image|request|second|minute)|GB|每秒|每次|每张/i;

export function detectCurrency(text: string): Currency | null {
  const hasCny = CNY.test(text);
  const hasUsd = USD.test(text);
  if (hasCny === hasUsd) return null;
  return hasCny ? "CNY" : "USD";
}

export function detectUnit(text: string): RawUnit | null {
  if (NON_TOKEN_UNIT.test(text)) return null;
  if (PER_1M.test(text)) return "per_1m";
  if (PER_1K.test(text)) return "per_1k";
  if (PER_TOKEN.test(text)) return "per_token";
  return null;
}

export function hasNonTokenUnit(text: string): boolean {
  return NON_TOKEN_UNIT.test(text);
}

export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 解析价格文本。返回 null 表示「不是价格」（空、"-"、"不支持"）。
 * 例："¥2"、"2元"、"2 元/百万tokens"、"0.002元/千tokens"、"$0.15"、"免费"、"限时免费"。
 * 一个单元格里有多个数字时（"原价$0.276（限时8折）"、"忙时 $0.283闲时 $0.141"）取第一个。
 */
export function parsePriceText(text: string, context: PriceContext = {}): ParsedPrice | null {
  const clean = normalizeSpace(text);
  if (clean === "" || NOT_A_PRICE.test(clean)) return null;
  const currency = detectCurrency(clean) ?? context.currency ?? null;
  const unit = detectUnit(clean) ?? context.unit ?? null;
  const match = NUMBER.exec(clean);
  if (!match?.[1]) {
    return FREE.test(clean) ? { value: 0, currency, unit } : null;
  }
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value, currency, unit };
}

/**
 * 单元格 + 表头（或单位列）上下文 → 完整价格。
 * - 不是价格 → null
 * - 单位或币种识别不了 → 抛 W2003（调用方记录日志并跳过该条，STYLE C6）
 */
export function resolvePrice(
  cell: string,
  context: PriceContext & { readonly sourceId: string },
): ResolvedPrice | null {
  const parsed = parsePriceText(cell, context);
  if (!parsed) return null;
  if (hasNonTokenUnit(cell)) {
    throw new PipelineError(
      "W2003",
      `${context.sourceId}：不是按 token 计价：${normalizeSpace(cell)}`,
      { sourceId: context.sourceId },
    );
  }
  if (!parsed.currency || !parsed.unit) {
    throw new PipelineError(
      "W2003",
      `${context.sourceId}：无法识别币种或单位：${normalizeSpace(cell)}`,
      { sourceId: context.sourceId },
    );
  }
  return { value: parsed.value, currency: parsed.currency, unit: parsed.unit };
}

// ───────────────────────── token 数量 ─────────────────────────

const TOKEN_COUNT = /(\d[\d,]*(?:\.\d+)?)\s*([KkMm万])?/;

/** "128K" → 128000，"1M" → 1000000，"1,048,576 tokens" → 1048576，"0.2K" → 200；识别不了返回 null */
export function parseTokenCount(text: string): number | null {
  const match = TOKEN_COUNT.exec(text.replace(/\s+/g, " "));
  if (!match?.[1]) return null;
  const base = Number(match[1].replace(/,/g, ""));
  const suffix = match[2]?.toUpperCase();
  const factor = suffix === "K" ? 1000 : suffix === "M" ? 1_000_000 : suffix === "万" ? 10_000 : 1;
  const value = Math.round(base * factor);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface TokenRange {
  readonly min: number;
  readonly max: number | null;
}

const COUNT = String.raw`\d[\d,]*(?:\.\d+)?\s*[KkMm]?`;
const BRACKET_RANGE = new RegExp(
  String.raw`[\[(]\s*(${COUNT})\s*[,，]\s*(${COUNT}|\+|\+?∞)?\s*[)\]]`,
);
const LT_RANGE = new RegExp(String.raw`(${COUNT})\s*<\s*Tokens?\s*[≤<]=?\s*(${COUNT})`, "i");
const GTE_RANGE = new RegExp(String.raw`(?:≥|>=|>)\s*(${COUNT})`);
const DASH_RANGE = new RegExp(String.raw`^(${COUNT})\s*[-~～]\s*(${COUNT})$`);

function toCount(text: string): number {
  return text.trim().replace(/[KkMm]$/, "") === "0" ? 0 : (parseTokenCount(text) ?? 0);
}

/** "[0, 32K)"、"[32K, +)"、"≥32K"、"0<Token≤256K"、"32k-128k" → 区间；识别不了返回 null */
export function parseTokenRange(text: string): TokenRange | null {
  const clean = normalizeSpace(text);
  const bracket = BRACKET_RANGE.exec(clean);
  if (bracket?.[1]) {
    const upper = bracket[2];
    const max = upper && /\d/.test(upper) ? toCount(upper) : null;
    return { min: toCount(bracket[1]), max };
  }
  const lt = LT_RANGE.exec(clean);
  if (lt?.[1] && lt[2]) return { min: toCount(lt[1]), max: toCount(lt[2]) };
  const gte = GTE_RANGE.exec(clean);
  if (gte?.[1]) return { min: toCount(gte[1]), max: null };
  const dash = DASH_RANGE.exec(clean);
  if (dash?.[1] && dash[2]) {
    // "128-256k"：前一个数没写单位时沿用后一个数的单位
    const unitSuffix = /[KkMm]$/.exec(dash[2])?.[0] ?? "";
    const lower = /[KkMm]$/.test(dash[1]) ? dash[1] : `${dash[1]}${unitSuffix}`;
    return { min: toCount(lower), max: toCount(dash[2]) };
  }
  return null;
}

// ───────────────────────── HTML 表格 ─────────────────────────

/** 选出所有匹配元素（顺带用来推导 cheerio 的元素类型，pnpm 下不能直接依赖 domhandler） */
export function selectAll($: cheerio.CheerioAPI, selector: string) {
  return $(selector).toArray();
}
export type HtmlElement = ReturnType<typeof selectAll>[number];

export interface TableGrid {
  /** 每列的表头文字（多级表头用空格拼接） */
  readonly headers: readonly string[];
  /** 已展开 rowspan/colspan 的数据行 */
  readonly rows: readonly (readonly string[])[];
  readonly element: HtmlElement;
}

interface RawCell {
  readonly text: string;
  readonly isHeader: boolean;
  readonly rowspan: number;
  readonly colspan: number;
}

function span(value: string | undefined): number {
  const n = Number(value ?? "1");
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 1;
}

/** 单元格文字：去掉 <sup> 脚注，<br> 当空格 */
export function cellText($: cheerio.CheerioAPI, node: HtmlElement): string {
  const copy = $(node).clone();
  copy.find("sup").remove();
  copy.find("br").replaceWith(" ");
  copy.find("p, div, li, blockquote").after(" ");
  return normalizeSpace(copy.text());
}

function placeRow(
  grid: (string | undefined)[][],
  rowIndex: number,
  cells: readonly RawCell[],
): void {
  const row = (grid[rowIndex] ??= []);
  let col = 0;
  for (const cell of cells) {
    while (row[col] !== undefined) col += 1;
    for (let r = 0; r < cell.rowspan; r += 1) {
      const target = (grid[rowIndex + r] ??= []);
      for (let c = 0; c < cell.colspan; c += 1) target[col + c] = cell.text;
    }
    col += cell.colspan;
  }
}

function buildGrid(
  $: cheerio.CheerioAPI,
  rows: readonly HtmlElement[],
): readonly (readonly string[])[] {
  const grid: (string | undefined)[][] = [];
  rows.forEach((tr, index) => {
    const cells = $(tr)
      .children("td, th")
      .toArray()
      .map((cell) => ({
        text: cellText($, cell),
        isHeader: cell.tagName === "th",
        rowspan: span($(cell).attr("rowspan")),
        colspan: span($(cell).attr("colspan")),
      }));
    placeRow(grid, index, cells);
  });
  const width = Math.max(0, ...grid.map((r) => r.length));
  return grid.slice(0, rows.length).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
}

function joinHeaders(headerRows: readonly (readonly string[])[], width: number): readonly string[] {
  return Array.from({ length: width }, (_, col) => {
    const parts = headerRows.map((r) => r[col] ?? "").filter((t) => t !== "");
    return [...new Set(parts)].join(" ");
  });
}

/** 把一个 <table> 读成 { headers, rows }；没有 <thead> 时，开头全是 <th> 的行算表头，否则第一行算表头 */
export function tableToGrid($: cheerio.CheerioAPI, table: HtmlElement): TableGrid {
  const trs = $(table)
    .find("tr")
    .toArray()
    .filter((tr) => $(tr).closest("table")[0] === table);
  const grid = buildGrid($, trs);
  const theadCount = trs.filter((tr) => $(tr).parent().is("thead")).length;
  const leadingTh = trs.findIndex((tr) => $(tr).children("td").length > 0);
  const headerCount = theadCount > 0 ? theadCount : leadingTh > 0 ? leadingTh : 1;
  const width = grid[0]?.length ?? 0;
  return {
    headers: joinHeaders(grid.slice(0, headerCount), width),
    rows: grid.slice(headerCount),
    element: table,
  };
}

export function readHtmlTables(
  html: string | cheerio.CheerioAPI,
  scope?: string,
): readonly TableGrid[] {
  const $ = typeof html === "string" ? cheerio.load(html) : html;
  const tables = scope ? $(scope).find("table") : $("table");
  return tables.toArray().map((table) => tableToGrid($, table));
}

/** 第一个表头文字匹配的列，找不到返回 -1（STYLE C4：不假设列的顺序） */
export function findColumn(headers: readonly string[], pattern: RegExp): number {
  return headers.findIndex((h) => pattern.test(h));
}

/** 按名字一次找齐必需的列；缺任何一列返回 null */
export function findColumns<K extends string>(
  headers: readonly string[],
  patterns: Readonly<Record<K, RegExp>>,
): Readonly<Record<K, number>> | null {
  const entries = Object.entries(patterns).map(
    ([key, pattern]) => [key, findColumn(headers, pattern as RegExp)] as const,
  );
  if (entries.some(([, index]) => index < 0)) return null;
  return Object.fromEntries(entries) as Record<K, number>;
}

/** 截断 notes 到 200 字以内（DEV §3.5 S6） */
export function joinNotes(parts: readonly (string | null | undefined)[]): string | undefined {
  const text = [
    ...new Set(parts.filter((p): p is string => typeof p === "string" && p.trim() !== "")),
  ].join("；");
  if (text === "") return undefined;
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** 按 key 去重，保留第一次出现的元素 */
export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
