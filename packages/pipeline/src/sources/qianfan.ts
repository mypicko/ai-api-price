/**
 * 百度千帆（文心）国内站人民币价格（静态 HTML，服务端渲染）。
 * 入口：https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya（千帆「模型服务计费」文档）
 *   2026-10-18 境外网络连不上；2026-11-20 实测 GitHub 托管运行器可以访问，因此重新注册。
 * 结构要点：
 * - 「<h3>文本生成</h3> <h4>按量后付费</h4> <table>」，另有「深度思考」「视觉理解」两节，同一模型可能重复出现，取第一次
 * - 表头：模型名称 | 版本名称 | 服务内容 | 子项 | 在线推理 | 批量推理… | 单位（元/千tokens）；前三列 rowspan 合并
 * - 子项：「输入」「输出」「命中缓存」，括号里是输入长度分档（输入<=32k、32k<输入<=128k）或峰谷时段（高峰时段：8:00-22:00）
 * - 价格单元格可能是「活动价：0.001原价：0.002」，取原价，活动价写进 notes
 * - 只收 ERNIE 开头的百度自家模型；千帆上的 DeepSeek、GLM、Kimi 等是转售，不收录
 * 最后核对：2026-11-20
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  detectUnit,
  findColumns,
  joinNotes,
  normalizeSpace,
  type TableGrid,
  tableToGrid,
} from "./parse-price";
import type { Source } from "./types";

export const QIANFAN_URL = "https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya";
const SOURCE_ID = "qianfan";
const SECTIONS: ReadonlySet<string> = new Set(["文本生成", "深度思考", "视觉理解"]);
const PAYG_HEADING = "按量后付费";

type Item = "input" | "output" | "cacheRead";

interface PriceCell {
  readonly item: Item;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number | null } | null;
  readonly offPeak: boolean;
  readonly promo: boolean;
}

interface ModelRows {
  readonly name: string;
  readonly cells: readonly PriceCell[];
}

function itemOf(subItem: string): Item | null {
  if (subItem.startsWith("命中缓存")) return "cacheRead";
  if (subItem.startsWith("输入")) return "input";
  if (subItem.startsWith("输出")) return "output";
  return null;
}

const toTokens = (k: string): number => Number(k) * 1000;

/** 「输入<=32k」→ 0~32000；「32k<输入<=128k」→ 32000~128000；「输入>128k」→ 128000~不限 */
function rangeOf(subItem: string): PriceCell["range"] {
  const bounded = /(?:(\d+)\s*k\s*<\s*)?输入\s*<=\s*(\d+)\s*k/i.exec(subItem);
  if (bounded?.[2])
    return { min: bounded[1] ? toTokens(bounded[1]) : 0, max: toTokens(bounded[2]) };
  const open = /输入\s*>\s*(\d+)\s*k/i.exec(subItem);
  return open?.[1] ? { min: toTokens(open[1]), max: null } : null;
}

/** 「活动价：0.001原价：0.002」取原价；普通单元格取第一个数；「-」等返回 null */
function priceOf(cell: string): { readonly value: number; readonly promo: boolean } | null {
  const original = /原价[：:]\s*(\d+(?:\.\d+)?)/.exec(cell);
  if (original?.[1]) return { value: Number(original[1]), promo: /活动价/.test(cell) };
  const plain = /\d+(?:\.\d+)?/.exec(cell);
  return plain ? { value: Number(plain[0]), promo: false } : null;
}

/** 「ERNIE 5.1」→ ERNIE-5.1（与千帆调用名一致的写法） */
const modelIdOf = (name: string): string => normalizeSpace(name).replace(/\s+/g, "-");

function parseTable(table: TableGrid, logger?: Logger): readonly ModelRows[] {
  const columns = findColumns(table.headers, {
    model: /^模型名称/,
    subItem: /^子项/,
    online: /^在线推理/,
    unit: /^单位/,
  });
  if (!columns) return [];
  const byModel = new Map<string, PriceCell[]>();
  for (const row of table.rows) {
    const name = modelIdOf(row[columns.model] ?? "");
    if (!name.startsWith("ERNIE")) continue;
    const subItem = normalizeSpace(row[columns.subItem] ?? "");
    const item = itemOf(subItem);
    const price = priceOf(row[columns.online] ?? "");
    if (!item || !price) continue;
    if (detectUnit(row[columns.unit] ?? "") !== "per_1k") {
      logger?.warn("qianfan：单位不是元/千tokens，跳过", {
        sourceId: SOURCE_ID,
        code: "W2003",
        row: row.join(" | "),
      });
      continue;
    }
    const cell: PriceCell = {
      item,
      value: price.value,
      range: rangeOf(subItem),
      offPeak: /空闲时段/.test(subItem),
      promo: price.promo,
    };
    byModel.set(name, [...(byModel.get(name) ?? []), cell]);
  }
  return [...byModel.entries()].map(([name, cells]) => ({ name, cells }));
}

const pick = (cells: readonly PriceCell[], item: Item): number | null =>
  cells.find((c) => c.item === item)?.value ?? null;

function buildTiers(cells: readonly PriceCell[]): readonly RawTier[] {
  const ranges = [
    ...new Map(cells.filter((c) => c.range).map((c) => [`${c.range?.min}`, c.range])).values(),
  ];
  return ranges.map((range) => {
    const inRange = cells.filter((c) => c.range?.min === range?.min);
    return {
      minInputTokens: range?.min ?? 0,
      maxInputTokens: range?.max ?? null,
      input: pick(inRange, "input"),
      output: pick(inRange, "output"),
    };
  });
}

function toOffering({ name, cells }: ModelRows): RawOffering {
  // 峰谷计价：标准价取高峰时段；分档计价：标准价取第一档
  const standard = cells.filter((c) => !c.offPeak);
  const first = standard.filter((c) => !c.range || c.range.min === 0);
  const tiers = buildTiers(standard);
  const cacheRead = pick(first, "cacheRead");
  const notes = joinNotes([
    cells.some((c) => c.offPeak)
      ? "高峰时段（8:00-22:00）价格；空闲时段（22:00-次日8:00）更低"
      : null,
    cells.some((c) => c.promo) ? "当前另有活动价，表中为原价" : null,
  ]);
  return {
    vendorHint: "baidu",
    modelName: name,
    displayName: name.replace(/-/g, " "),
    currency: "CNY",
    unit: "per_1k",
    input: pick(first, "input"),
    output: pick(first, "output"),
    ...(cacheRead === null ? {} : { cacheRead }),
    ...(tiers.length > 1 ? { tiers: [...tiers] } : {}),
    sourceUrl: QIANFAN_URL,
    ...(notes ? { notes } : {}),
  };
}

/** 按文档顺序找出指定章节下「按量后付费」的价格表 */
function paygTables($: cheerio.CheerioAPI): readonly TableGrid[] {
  let section = "";
  let heading = "";
  return $("h3, h4, table")
    .toArray()
    .flatMap((el) => {
      if (el.tagName === "h3") {
        section = normalizeSpace($(el).text());
        heading = "";
        return [];
      }
      if (el.tagName === "h4") {
        heading = normalizeSpace($(el).text());
        return [];
      }
      return SECTIONS.has(section) && heading === PAYG_HEADING ? [tableToGrid($, el)] : [];
    });
}

export function parseQianfanHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  const models = new Map<string, ModelRows>();
  for (const table of paygTables($))
    for (const rows of parseTable(table, logger))
      if (!models.has(rows.name)) models.set(rows.name, rows);
  const offerings = [...models.values()]
    .filter((m) => pick(m.cells, "input") !== null || pick(m.cells, "output") !== null)
    .map(toOffering);
  if (offerings.length === 0)
    throw new PipelineError("E2001", "qianfan：找不到「按量后付费」价格表里的 ERNIE 模型", {
      sourceId: SOURCE_ID,
    });
  return offerings;
}

export const qianfanSource: Source = {
  id: SOURCE_ID,
  platform: "official-cn",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(QIANFAN_URL, { timeoutMs: 30_000 });
    const offerings = parseQianfanHtml(html, ctx.logger);
    ctx.logger.info("qianfan 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
