/**
 * 月之暗面 Kimi 官方价格（Mintlify 文档站）。
 * 入口（抓取）：https://platform.kimi.ai/docs/pricing/chat（HTML，无需渲染）
 *   2026-10-20 起 .md 导出里的价格表变成空表（<tbody />），价格只在 HTML 内嵌的已编译 MDX 里：
 *   DocTable,{columns:[{title:`Model`}…],rows:[[`kimi-k2.6`,`1M tokens`,_jsxs(_Fragment,{children:[`$`,`0.16`]})…]]}
 *   所以先解析 HTML；HTML 里找不到时再试 .md（旧格式，兼容站点改回去的情况）
 * 证据链接（sourceUrl）：https://platform.moonshot.ai/docs/pricing/chat（官方域名，302 跳转到上面的页面）
 * 为什么不用 platform.moonshot.cn：2026-10-18 实测境外网络（含 GitHub Actions 所在网络）无法连接该主机；
 *   platform.moonshot.ai 会跨域跳转到 platform.kimi.ai，http 客户端不跟随跨域跳转，所以直接请求跳转目标。
 * 结构要点：
 * - 价格表是 <DocTable columns={[{ title: "..." }]} rows={[[...], ...]} /> 组件，按 title 定位列
 * - 价格单元格形如 <>{"$"}3.00</>，单位列 "1M tokens"，上下文列 "1,048,576 tokens"
 * - K3 系列有缓存写入价（TTL 5min / 1h），cacheWrite 取默认的 5min，1h 写进 notes
 * 最后核对：2026-10-23
 */
import type { RawOffering } from "@aipb/shared";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import { detectUnit, findColumn, joinNotes, parseTokenCount, resolvePrice } from "./parse-price";
import type { Source } from "./types";

export const MOONSHOT_FETCH_URL = "https://platform.kimi.ai/docs/pricing/chat";
export const MOONSHOT_MARKDOWN_URL = "https://platform.kimi.ai/docs/pricing/chat.md";
export const MOONSHOT_URL = "https://platform.moonshot.ai/docs/pricing/chat";
const SOURCE_ID = "moonshot";

export interface DocTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** 结束标记 "/>" 独占一行（单元格里的 </> 也含 "/>"，不能用非贪婪匹配到第一个） */
const DOC_TABLE = /<DocTable\b([\s\S]*?)^\s*\/>/gm;
const TITLE = /title:\s*"((?:[^"\\]|\\.)*)"/g;
const ROW_LINE = /^\s*\[(.*)\],?\s*$/gm;
/** 一个单元格：JSX 片段 <>…</> 或字符串字面量 */
const CELL = /<>([\s\S]*?)<\/>|"((?:[^"\\]|\\.)*)"/g;

function jsxText(fragment: string): string {
  return fragment
    .replace(/\{\s*"((?:[^"\\]|\\.)*)"\s*\}/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function parseRow(line: string): readonly string[] {
  return [...line.matchAll(CELL)].map((m) => (m[1] !== undefined ? jsxText(m[1]) : (m[2] ?? "")));
}

/** 从 Markdown 里找出所有 <DocTable />；rows={[ 之后的每一行 [...] 是一行数据 */
export function parseDocTables(markdown: string): readonly DocTable[] {
  return [...markdown.matchAll(DOC_TABLE)].map((match) => {
    const body = match[1] ?? "";
    const [columnsPart = "", rowsPart = ""] = body.split(/rows\s*=\s*\{/);
    return {
      headers: [...columnsPart.matchAll(TITLE)].map((m) => m[1] ?? ""),
      rows: [...rowsPart.matchAll(ROW_LINE)].map((m) => parseRow(m[1] ?? "")),
    };
  });
}

/** 已编译 MDX 里的 DocTable：DocTable,{columns:[…],rows:[…]} */
const COMPILED_TABLE = /DocTable,\{columns:\[/g;
const COMPILED_TITLE = /title:`((?:[^`\\]|\\.)*)`/g;
const BACKTICK = /`((?:[^`\\]|\\.)*)`/g;

/** 从 start（指向 "["）开始找到配对的 "]"，跳过反引号字符串；返回 "]" 的下标，找不到返回 -1 */
function matchBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === "`") inString = false;
      continue;
    }
    if (ch === "`") inString = true;
    else if (ch === "[" || ch === "{" || ch === "(") depth += 1;
    else if (ch === "]" || ch === "}" || ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 数组字面量 "[a,b,[c]]" 的顶层元素（按顶层逗号切开） */
function topLevelItems(arrayText: string): readonly string[] {
  const inner = arrayText.slice(1, -1);
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let from = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === "`") inString = false;
      continue;
    }
    if (ch === "`") inString = true;
    else if (ch === "[" || ch === "{" || ch === "(") depth += 1;
    else if (ch === "]" || ch === "}" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      items.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  if (inner.slice(from).trim() !== "") items.push(inner.slice(from));
  return items;
}

/** 单元格：字符串直接取；_jsxs(_Fragment,{children:[`$`,`0.16`]}) 取出所有字符串拼起来 */
function compiledCell(item: string): string {
  return [...item.matchAll(BACKTICK)]
    .map((m) => m[1] ?? "")
    .join("")
    .trim();
}

/** 从 HTML 内嵌的已编译 MDX 里找出所有 DocTable */
export function parseCompiledDocTables(html: string): readonly DocTable[] {
  return [...html.matchAll(COMPILED_TABLE)].flatMap((match) => {
    const columnsStart = (match.index ?? 0) + match[0].length - 1;
    const columnsEnd = matchBracket(html, columnsStart);
    if (columnsEnd < 0) return [];
    const headers = [...html.slice(columnsStart, columnsEnd).matchAll(COMPILED_TITLE)].map(
      (m) => m[1] ?? "",
    );
    const rowsKey = html.indexOf("rows:[", columnsEnd);
    if (rowsKey < 0 || rowsKey - columnsEnd > 20) return [];
    const rowsStart = rowsKey + "rows:".length;
    const rowsEnd = matchBracket(html, rowsStart);
    if (rowsEnd < 0) return [];
    const rows = topLevelItems(html.slice(rowsStart, rowsEnd + 1)).map((row) =>
      topLevelItems(row.trim()).map(compiledCell),
    );
    return [{ headers, rows }];
  });
}

interface Columns {
  readonly model: number;
  readonly unit: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cacheWrite1h: number;
  readonly context: number;
}

function locateColumns(headers: readonly string[]): Columns | null {
  const columns: Columns = {
    model: findColumn(headers, /^(Model|模型)/i),
    unit: findColumn(headers, /^(Unit|计费单位|单位)/i),
    input: findColumn(headers, /^(Input Price(?!\s*\(Cache Hit\))|输入价格(?!.*缓存命中))/i),
    output: findColumn(headers, /^(Output Price|输出价格)/i),
    cacheRead: findColumn(headers, /Cache Hit|Cached Input|缓存命中/i),
    cacheWrite: findColumn(headers, /(Cache Write|缓存写入)(?!.*1\s*h)/i),
    cacheWrite1h: findColumn(headers, /(Cache Write|缓存写入).*1\s*h/i),
    context: findColumn(headers, /Context|上下文/i),
  };
  return columns.model < 0 || columns.input < 0 || columns.output < 0 ? null : columns;
}

function cell(row: readonly string[], index: number): string {
  return index >= 0 ? (row[index] ?? "") : "";
}

function toOffering(row: readonly string[], columns: Columns): RawOffering | null {
  const modelName = cell(row, columns.model);
  if (modelName === "") return null;
  const unitText = cell(row, columns.unit);
  const ctx = { sourceId: SOURCE_ID, unit: detectUnit(unitText) };
  const input = resolvePrice(cell(row, columns.input), ctx);
  const output = resolvePrice(cell(row, columns.output), ctx);
  const reference = input ?? output;
  if (!reference) return null;
  const price = (index: number): number | null =>
    resolvePrice(cell(row, index), ctx)?.value ?? null;
  const write1h = price(columns.cacheWrite1h);
  const notes = joinNotes([
    write1h === null ? null : `缓存写入（TTL 1h）${cell(row, columns.cacheWrite1h)}，默认 TTL 5min`,
  ]);
  return {
    vendorHint: "moonshot",
    modelName,
    currency: reference.currency,
    unit: reference.unit,
    input: input?.value ?? null,
    output: output?.value ?? null,
    cacheRead: price(columns.cacheRead),
    ...(columns.cacheWrite >= 0 ? { cacheWrite: price(columns.cacheWrite) } : {}),
    contextWindow: parseTokenCount(cell(row, columns.context)),
    sourceUrl: MOONSHOT_URL,
    ...(notes ? { notes } : {}),
  };
}

function safeOffering(
  row: readonly string[],
  columns: Columns,
  logger?: Logger,
): readonly RawOffering[] {
  try {
    const offering = toOffering(row, columns);
    return offering ? [offering] : [];
  } catch (error) {
    logger?.warn("moonshot：跳过无法识别的价格行", {
      sourceId: SOURCE_ID,
      code: "W2003",
      row: row.join(" | "),
      error,
    });
    return [];
  }
}

function offeringsFrom(tables: readonly DocTable[], logger?: Logger): RawOffering[] {
  return tables.flatMap((table) => {
    const columns = locateColumns(table.headers);
    return columns ? table.rows.flatMap((row) => safeOffering(row, columns, logger)) : [];
  });
}

function noTable(): PipelineError {
  return new PipelineError("E2001", "moonshot：找不到含 Model / Input / Output 列的价格表", {
    sourceId: SOURCE_ID,
  });
}

/** HTML 页面（已编译 MDX） */
export function parseMoonshotHtml(html: string, logger?: Logger): RawOffering[] {
  const offerings = offeringsFrom(parseCompiledDocTables(html), logger);
  if (offerings.length === 0) throw noTable();
  return offerings;
}

export function parseMoonshotMarkdown(markdown: string, logger?: Logger): RawOffering[] {
  const offerings = parseDocTables(markdown).flatMap((table) => {
    const columns = locateColumns(table.headers);
    return columns ? table.rows.flatMap((row) => safeOffering(row, columns, logger)) : [];
  });
  if (offerings.length === 0) throw noTable();
  return offerings;
}

export const moonshotSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "html",
  timeoutMs: 30_000,
  async fetch(ctx) {
    let offerings: RawOffering[];
    try {
      offerings = parseMoonshotHtml(await ctx.http.getText(MOONSHOT_FETCH_URL), ctx.logger);
    } catch (error) {
      ctx.logger.warn("moonshot：HTML 里没有价格表，改用 .md 导出", { sourceId: SOURCE_ID, error });
      offerings = parseMoonshotMarkdown(await ctx.http.getText(MOONSHOT_MARKDOWN_URL), ctx.logger);
    }
    ctx.logger.info("moonshot 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
