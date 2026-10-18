/**
 * 月之暗面 Kimi 官方价格（Mintlify 文档站的 Markdown 导出，纯文本，无需渲染）。
 * 入口（抓取）：https://platform.kimi.ai/docs/pricing/chat.md
 * 证据链接（sourceUrl）：https://platform.moonshot.ai/docs/pricing/chat（官方域名，302 跳转到上面的页面）
 * 为什么不用 platform.moonshot.cn：2026-10-18 实测境外网络（含 GitHub Actions 所在网络）无法连接该主机；
 *   platform.moonshot.ai 会跨域跳转到 platform.kimi.ai，http 客户端不跟随跨域跳转，所以直接请求跳转目标。
 * 结构要点：
 * - 价格表是 <DocTable columns={[{ title: "..." }]} rows={[[...], ...]} /> 组件，按 title 定位列
 * - 价格单元格形如 <>{"$"}3.00</>，单位列 "1M tokens"，上下文列 "1,048,576 tokens"
 * - K3 系列有缓存写入价（TTL 5min / 1h），cacheWrite 取默认的 5min，1h 写进 notes
 * 最后核对：2026-10-18
 */
import type { RawOffering } from "@aipb/shared";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import { detectUnit, findColumn, joinNotes, parseTokenCount, resolvePrice } from "./parse-price";
import type { Source } from "./types";

export const MOONSHOT_FETCH_URL = "https://platform.kimi.ai/docs/pricing/chat.md";
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

export function parseMoonshotMarkdown(markdown: string, logger?: Logger): RawOffering[] {
  const offerings = parseDocTables(markdown).flatMap((table) => {
    const columns = locateColumns(table.headers);
    return columns ? table.rows.flatMap((row) => safeOffering(row, columns, logger)) : [];
  });
  if (offerings.length === 0) {
    throw new PipelineError("E2001", "moonshot：找不到含 Model / Input / Output 列的价格表", {
      sourceId: SOURCE_ID,
    });
  }
  return offerings;
}

export const moonshotSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "html",
  timeoutMs: 30_000,
  async fetch(ctx) {
    const markdown = await ctx.http.getText(MOONSHOT_FETCH_URL);
    const offerings = parseMoonshotMarkdown(markdown, ctx.logger);
    ctx.logger.info("moonshot 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
