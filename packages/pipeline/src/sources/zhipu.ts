/**
 * 智谱开放平台官方价格（静态 HTML，Mintlify 文档站服务端渲染）。
 * 入口：https://docs.bigmodel.cn/cn/guide/start/pricing
 *   （open.bigmodel.cn/pricing 是营销页，只有几个旗舰模型；它的「详细价格」按钮指向这里）
 * 结构要点：
 * - 每类模型一张表，表头「模型名称 | 上下文 | 输入单价（元/百万 Tokens）| 输出单价 | 缓存存储 | 缓存命中 | 输入模态」
 * - 阶梯价：同一个模型占多行，「上下文」列写「输入长度 [0, 32K)」「输入长度 ≥32K」
 * - GLM-4.7 等还按输出长度分档（「输入 [0, 32K)，输出 [0, 0.2K)」），tiers 只表达输入分档，取每档第一行，其余写进 notes
 * - 按次 / 按字符计价的表（图像、视频、语音）表头没有「输入单价 + 输出单价」，自动跳过
 * 最后核对：2026-10-18
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  detectCurrency,
  detectUnit,
  findColumn,
  findColumns,
  joinNotes,
  parseTokenCount,
  parseTokenRange,
  normalizeSpace,
  resolvePrice,
  tableToGrid,
  type TableGrid,
  type TokenRange,
  uniqueBy,
} from "./parse-price";
import type { Source } from "./types";

export const ZHIPU_URL = "https://docs.bigmodel.cn/cn/guide/start/pricing";
const SOURCE_ID = "zhipu";

interface Columns {
  readonly name: number;
  readonly context: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly modality: number;
}

interface PriceRow {
  readonly name: string;
  readonly contextText: string;
  readonly range: TokenRange | null;
  readonly hasOutputCondition: boolean;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
  readonly modality: string;
}

interface TableContext {
  readonly columns: Columns;
  /** 表格没有「输入模态」列时的默认模态（由所在章节标题决定） */
  readonly defaultModalities: readonly string[];
  readonly currency: "CNY" | "USD";
  readonly unit: "per_token" | "per_1k" | "per_1m";
}

function tableContext(table: TableGrid, heading: string): TableContext | null {
  const required = findColumns(table.headers, {
    name: /模型名称|^模型$/,
    input: /^输入(单价|价格)/,
    output: /^输出(单价|价格)/,
  });
  if (!required) return null;
  const inputHeader = table.headers[required.input] ?? "";
  const currency = detectCurrency(inputHeader);
  const unit = detectUnit(inputHeader);
  if (!currency || !unit) return null;
  return {
    columns: {
      ...required,
      context: findColumn(table.headers, /上下文/),
      cacheRead: findColumn(table.headers, /缓存命中/),
      modality: findColumn(table.headers, /输入模态/),
    },
    currency,
    unit,
    defaultModalities: /视觉|多模态/.test(heading) ? ["text", "image"] : ["text"],
  };
}

function price(cell: string | undefined, ctx: TableContext): number | null {
  return (
    resolvePrice(cell ?? "", { sourceId: SOURCE_ID, currency: ctx.currency, unit: ctx.unit })
      ?.value ?? null
  );
}

function toPriceRow(row: readonly string[], ctx: TableContext): PriceRow | null {
  const { columns } = ctx;
  const name = row[columns.name] ?? "";
  if (name === "") return null;
  const contextText = columns.context >= 0 ? (row[columns.context] ?? "") : "";
  const inputPart = contextText.split(/[，,]\s*输出/)[0] ?? contextText;
  return {
    name,
    contextText,
    range: /输入/.test(contextText) ? parseTokenRange(inputPart) : null,
    hasOutputCondition: /输出/.test(contextText),
    input: price(row[columns.input], ctx),
    output: price(row[columns.output], ctx),
    cacheRead: columns.cacheRead >= 0 ? price(row[columns.cacheRead], ctx) : null,
    modality: columns.modality >= 0 ? (row[columns.modality] ?? "") : "",
  };
}

function toModalities(text: string, fallback: readonly string[]): readonly string[] {
  const map: readonly (readonly [RegExp, string])[] = [
    [/文本/, "text"],
    [/图片|图像/, "image"],
    [/视频/, "video"],
    [/文件|PDF/i, "file"],
    [/音频/, "audio"],
  ];
  const found = map.filter(([re]) => re.test(text)).map(([, m]) => m);
  return found.length > 0 ? found : fallback;
}

/** 同一输入档位只取第一行（输出长度分档的其余行写进 notes） */
function buildTiers(rows: readonly PriceRow[]): readonly RawTier[] {
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (!r.range) return [];
    const key = `${r.range.min}-${r.range.max ?? ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [
      {
        minInputTokens: r.range.min,
        maxInputTokens: r.range.max,
        input: r.input,
        output: r.output,
        cacheRead: r.cacheRead,
      },
    ];
  });
}

function toOffering(rows: readonly PriceRow[], ctx: TableContext): RawOffering {
  const [first] = rows;
  if (!first) throw new PipelineError("E2001", "zhipu：空的模型分组", { sourceId: SOURCE_ID });
  const tiers = buildTiers(rows);
  const lastMax = tiers.at(-1)?.maxInputTokens ?? null;
  const contextWindow = first.range ? lastMax : parseTokenCount(first.contextText);
  const notes = joinNotes([
    rows.some((r) => r.hasOutputCondition) ? "部分档位按输出长度另行计价，详见官网" : null,
  ]);
  return {
    vendorHint: "zhipu",
    modelName: first.name.toLowerCase(),
    displayName: first.name,
    currency: ctx.currency,
    unit: ctx.unit,
    input: first.input,
    output: first.output,
    cacheRead: first.cacheRead,
    ...(tiers.length > 1 ? { tiers: [...tiers] } : {}),
    contextWindow,
    modalities: [...toModalities(first.modality, ctx.defaultModalities)],
    sourceUrl: ZHIPU_URL,
    ...(notes ? { notes } : {}),
  };
}

function parseTable(table: TableGrid, ctx: TableContext, logger?: Logger): readonly RawOffering[] {
  const rows = table.rows.flatMap((row) => {
    try {
      const parsed = toPriceRow(row, ctx);
      return parsed ? [parsed] : [];
    } catch (error) {
      logger?.warn("zhipu：跳过无法识别的价格行", {
        sourceId: SOURCE_ID,
        code: "W2003",
        row: row.join(" | "),
        error,
      });
      return [];
    }
  });
  const groups = new Map<string, PriceRow[]>();
  for (const row of rows) groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
  return [...groups.values()].map((group) => toOffering(group, ctx));
}

export function parseZhipuHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  let heading = "";
  const offerings = $("h2, h3, table")
    .toArray()
    .flatMap((el) => {
      if (el.tagName !== "table") {
        heading = normalizeSpace($(el).text());
        return [];
      }
      const grid = tableToGrid($, el);
      const ctx = tableContext(grid, heading);
      return ctx ? parseTable(grid, ctx, logger) : [];
    });
  const unique = uniqueBy(offerings, (o) => o.modelName);
  if (unique.length === 0)
    throw new PipelineError("E2001", "zhipu：找不到含「输入单价 / 输出单价」的价格表", {
      sourceId: SOURCE_ID,
    });
  return unique;
}

export const zhipuSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "html",
  timeoutMs: 30_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(ZHIPU_URL);
    const offerings = parseZhipuHtml(html, ctx.logger);
    ctx.logger.info("zhipu 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
