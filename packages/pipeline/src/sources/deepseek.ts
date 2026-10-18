/**
 * DeepSeek 官方价格（静态 HTML，Docusaurus 服务端渲染）。
 * 入口：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 结构要点：
 * - 一张「转置」的表：第一行是「模型 | <model-id> | <model-id> …」，模型 ID 就是 API 的 model 参数
 * - 左侧 1~3 列是行标签（rowspan/colspan 合并）：「价格 / 百万tokens输入（缓存命中） / 高峰时段」
 * - 价格分「空闲时段 / 高峰时段」，标准价取高峰时段，空闲时段写进 notes
 * - 单位来自行标签（"百万tokens"），币种来自单元格（"2元"）
 * 最后核对：2026-10-18
 */
import type { RawOffering } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import {
  joinNotes,
  parseTokenCount,
  readHtmlTables,
  resolvePrice,
  type TableGrid,
} from "./parse-price";
import type { Source } from "./types";

export const DEEPSEEK_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
const SOURCE_ID = "deepseek";

type PriceKind = "cacheRead" | "input" | "output";

interface LabeledRow {
  readonly label: string;
  readonly values: readonly string[];
}

const PEAK = /高峰/;
const OFF_PEAK = /空闲|闲时|夜间|优惠时段/;

function classify(label: string): PriceKind | null {
  if (/输入/.test(label) && /缓存命中/.test(label)) return "cacheRead";
  if (/输入/.test(label)) return "input";
  if (/输出/.test(label)) return "output";
  return null;
}

function findPriceTable(html: string): TableGrid {
  const $ = cheerio.load(html);
  const table = readHtmlTables($).find(
    (t) =>
      /^模型/.test(t.headers[0] ?? "") &&
      t.rows.some((r) => r.some((c) => /百万\s*tokens|千\s*tokens/i.test(c))),
  );
  if (!table)
    throw new PipelineError("E2001", "deepseek：找不到价格表（表头「模型」+「百万tokens」）", {
      sourceId: SOURCE_ID,
    });
  return table;
}

/** 表头里和第 0 列文字相同的列都是标签列，其余是模型列 */
function splitColumns(table: TableGrid): {
  readonly labelCols: number;
  readonly models: readonly string[];
} {
  const first = table.headers[0] ?? "";
  const labelCols = table.headers.findIndex((h) => h !== first);
  if (labelCols <= 0)
    throw new PipelineError("E2001", "deepseek：价格表里没有模型列", { sourceId: SOURCE_ID });
  return { labelCols, models: table.headers.slice(labelCols) };
}

function toLabeledRows(table: TableGrid, labelCols: number): readonly LabeledRow[] {
  return table.rows.map((row) => ({
    label: [...new Set(row.slice(0, labelCols))].join(" "),
    values: row.slice(labelCols),
  }));
}

/** 同一种价格有分时段时，标准价用高峰时段；没有分时段就用唯一的那一行 */
function pickRows(
  rows: readonly LabeledRow[],
  kind: PriceKind,
): { readonly standard?: LabeledRow; readonly offPeak?: LabeledRow } {
  const matched = rows.filter((r) => /tokens/i.test(r.label) && classify(r.label) === kind);
  const standard =
    matched.find((r) => PEAK.test(r.label)) ?? matched.find((r) => !OFF_PEAK.test(r.label));
  const offPeak = matched.find((r) => OFF_PEAK.test(r.label));
  return { ...(standard ? { standard } : {}), ...(offPeak ? { offPeak } : {}) };
}

function valueAt(row: LabeledRow | undefined, index: number): number | null {
  if (!row) return null;
  const cell = row.values[index] ?? "";
  return resolvePrice(cell, { sourceId: SOURCE_ID, ...unitContext(row.label) })?.value ?? null;
}

function unitContext(label: string): { readonly unit: "per_1m" | "per_1k" | null } {
  if (/百万\s*tokens/i.test(label)) return { unit: "per_1m" };
  if (/千\s*tokens/i.test(label)) return { unit: "per_1k" };
  return { unit: null };
}

function currencyOf(row: LabeledRow | undefined, index: number): "CNY" | "USD" {
  const cell = row?.values[index] ?? "";
  const resolved = resolvePrice(cell, { sourceId: SOURCE_ID, ...unitContext(row?.label ?? "") });
  if (!resolved)
    throw new PipelineError("W2003", `deepseek：无法识别币种：${cell}`, { sourceId: SOURCE_ID });
  return resolved.currency;
}

function rowValue(rows: readonly LabeledRow[], pattern: RegExp, index: number): string | undefined {
  return rows.find((r) => pattern.test(r.label))?.values[index];
}

function offPeakNote(
  picks: Readonly<Record<PriceKind, ReturnType<typeof pickRows>>>,
  index: number,
): string | undefined {
  if (!picks.input.offPeak && !picks.output.offPeak) return undefined;
  const fmt = (kind: PriceKind, name: string): string | null => {
    const value = valueAt(picks[kind].offPeak, index);
    return value === null ? null : `${name} ${value}`;
  };
  const parts = [fmt("input", "输入"), fmt("cacheRead", "缓存命中"), fmt("output", "输出")].filter(
    (p) => p !== null,
  );
  return `空闲时段价格（单位同标准价）：${parts.join("、")}`;
}

export function parseDeepseekHtml(html: string, sourceUrl: string = DEEPSEEK_URL): RawOffering[] {
  const table = findPriceTable(html);
  const { labelCols, models } = splitColumns(table);
  const rows = toLabeledRows(table, labelCols);
  const picks = {
    input: pickRows(rows, "input"),
    output: pickRows(rows, "output"),
    cacheRead: pickRows(rows, "cacheRead"),
  };
  if (!picks.input.standard || !picks.output.standard) {
    throw new PipelineError("E2001", "deepseek：找不到输入/输出价格行", { sourceId: SOURCE_ID });
  }
  const unit = unitContext(picks.input.standard.label).unit;
  if (!unit)
    throw new PipelineError("W2003", `deepseek：无法识别单位：${picks.input.standard.label}`, {
      sourceId: SOURCE_ID,
    });

  return models.map((modelName, index) => {
    const version = rowValue(rows, /模型版本/, index);
    const context = rowValue(rows, /上下文长度/, index);
    const maxOut = rowValue(rows, /输出长度/, index);
    const notes = joinNotes([offPeakNote(picks, index)]);
    return {
      vendorHint: "deepseek",
      modelName,
      ...(version ? { displayName: version } : {}),
      currency: currencyOf(picks.input.standard, index),
      unit,
      input: valueAt(picks.input.standard, index),
      output: valueAt(picks.output.standard, index),
      cacheRead: valueAt(picks.cacheRead.standard, index),
      contextWindow: context ? parseTokenCount(context) : null,
      maxOutput: maxOut ? parseTokenCount(maxOut) : null,
      sourceUrl,
      ...(notes ? { notes } : {}),
    };
  });
}

export const deepseekSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "html",
  timeoutMs: 30_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(DEEPSEEK_URL);
    const offerings = parseDeepseekHtml(html);
    ctx.logger.info("deepseek 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
