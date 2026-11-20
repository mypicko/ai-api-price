/**
 * 腾讯混元国内站人民币价格（TokenHub「模型价格」文档，静态 HTML，服务端渲染，gzip 压缩）。
 * 入口：https://cloud.tencent.com/document/product/1823/130055
 *   2026-11-20 实测 GitHub 托管运行器可以访问（约 8 秒）。混元旧平台已停止新购，仍由 config/manual/hunyuan-legacy-cn.yaml 维护。
 * 结构要点：
 * - 「<h3>语言模型</h3> <h4>按 Token 计费（后付费）</h4>」下有两张表：第一张是广州地域，第二张是新加坡地域，只取第一张
 * - 表头：模型名称 | model（调用参数）| 条件（token）| 峰谷计费 | 推理输入 | 推理输出 | 缓存命中 | 缓存写入-5min | 缓存写入-1h（元/百万 tokens）
 * - 条件列是输入长度分档（「输入长度（0, 32k]」「输入长度 32k+」），峰谷计费列是「高峰时段 / 空闲时段」，其余为「-」
 * - 只收调用参数以 hy / hunyuan 开头的腾讯自家模型；TokenHub 上的 DeepSeek、GLM、Kimi 等是转售，不收录
 * - 页面开头的「Hy4 限时折扣说明：…至 2026 年 12 月 31 日…按目录价格的 50% 结算」写进对应模型的 notes，价格记目录价
 * 最后核对：2026-11-20
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  findColumn,
  findColumns,
  joinNotes,
  normalizeSpace,
  parseTokenRange,
  type TableGrid,
  tableToGrid,
  type TokenRange,
} from "./parse-price";
import type { Source } from "./types";

export const HUNYUAN_URL = "https://cloud.tencent.com/document/product/1823/130055";
const SOURCE_ID = "hunyuan";
const SECTION = "语言模型";
const PAYG_HEADING = /^按\s*Token\s*计费/i;
const OWN_MODEL = /^(hy|hunyuan)/i;
const PRICE = /^\d+(?:\.\d+)?$/;

interface PriceRow {
  readonly model: string;
  readonly displayName: string;
  readonly range: TokenRange | null;
  readonly offPeak: boolean;
  readonly peakPricing: boolean;
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheRead: number | null;
}

/** 「输入长度（0, 32k]」→ 0~32000；「输入长度 32k+」→ 32000~不限；「-」→ null */
function rangeOf(condition: string): TokenRange | null {
  const text = normalizeSpace(condition).replace(/（/g, "(").replace(/）/g, ")");
  const open = /(\d+)\s*k\s*\+/i.exec(text);
  if (open?.[1]) return { min: Number(open[1]) * 1000, max: null };
  return parseTokenRange(text.replace(/^输入长度\s*/, ""));
}

const priceOf = (cell: string | undefined): number | null => {
  const text = normalizeSpace(cell ?? "");
  return PRICE.test(text) ? Number(text) : null;
};

function parseTable(table: TableGrid, logger?: Logger): readonly PriceRow[] {
  const columns = findColumns(table.headers, {
    name: /^模型名称/,
    model: /^model/i,
    input: /^推理输入/,
    output: /^推理输出/,
  });
  if (!columns) return [];
  const condition = findColumn(table.headers, /^条件/);
  const peak = findColumn(table.headers, /^峰谷/);
  const cacheRead = findColumn(table.headers, /^缓存命中/);
  return table.rows.flatMap((row) => {
    const model = normalizeSpace(row[columns.model] ?? "").split(" ")[0] ?? "";
    if (!OWN_MODEL.test(model)) return [];
    const input = priceOf(row[columns.input]);
    const output = priceOf(row[columns.output]);
    if (input === null && output === null) {
      logger?.warn("hunyuan：跳过没有价格的行", {
        sourceId: SOURCE_ID,
        code: "W2003",
        row: row.join(" | "),
      });
      return [];
    }
    const peakText = peak >= 0 ? normalizeSpace(row[peak] ?? "") : "";
    return [
      {
        model,
        displayName: normalizeSpace(row[columns.name] ?? "") || model,
        range: condition >= 0 ? rangeOf(row[condition] ?? "") : null,
        offPeak: peakText.includes("空闲"),
        peakPricing: peakText.includes("时段"),
        input,
        output,
        cacheRead: cacheRead >= 0 ? priceOf(row[cacheRead]) : null,
      },
    ];
  });
}

/** 页面开头的「<名称> 限时折扣说明：…至 YYYY 年 M 月 D 日…目录价格的 N% 结算」，按小写名称索引 */
function discountNotes($: cheerio.CheerioAPI): ReadonlyMap<string, string> {
  const parts = normalizeSpace($("body").text()).split("限时折扣说明：");
  const notes = new Map<string, string>();
  parts.slice(1).forEach((body, i) => {
    const name = /(?:\d+\.\s*)?([A-Za-z][\w .-]*?)\s*$/.exec(parts[i] ?? "")?.[1];
    const until = /至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(body);
    const pct = /目录价格的\s*(\d+)\s*%/.exec(body)?.[1];
    if (!name || !until || !pct) return;
    const date = `${until[1]}-${until[2]?.padStart(2, "0")}-${until[3]?.padStart(2, "0")}`;
    notes.set(name.toLowerCase(), `${date} 前限时按目录价的 ${pct}% 结算，表中为目录价`);
  });
  return notes;
}

function buildTiers(rows: readonly PriceRow[]): readonly RawTier[] {
  return rows
    .filter((r) => r.range !== null)
    .map((r) => ({
      minInputTokens: r.range?.min ?? 0,
      maxInputTokens: r.range?.max ?? null,
      input: r.input,
      output: r.output,
    }));
}

function toOffering(
  rows: readonly PriceRow[],
  discounts: ReadonlyMap<string, string>,
): RawOffering {
  // 峰谷计费：标准价取高峰时段；分档计价：标准价取第一档
  const standard = rows.filter((r) => !r.offPeak);
  const [first] = standard.length > 0 ? standard : rows;
  if (!first) throw new PipelineError("E2001", "hunyuan：空的模型分组", { sourceId: SOURCE_ID });
  const tiers = buildTiers(standard);
  const notes = joinNotes([
    discounts.get(first.displayName.toLowerCase()),
    rows.some((r) => r.peakPricing) ? "表中为高峰时段价格；空闲时段更低" : null,
  ]);
  return {
    vendorHint: "tencent",
    modelName: first.model,
    displayName: first.displayName,
    currency: "CNY",
    unit: "per_1m",
    input: first.input,
    output: first.output,
    ...(first.cacheRead === null ? {} : { cacheRead: first.cacheRead }),
    ...(tiers.length > 1 ? { tiers: [...tiers] } : {}),
    sourceUrl: HUNYUAN_URL,
    ...(notes ? { notes } : {}),
  };
}

/** 「语言模型」章节下第一张「按 Token 计费」价格表（广州地域） */
function firstLanguageTable($: cheerio.CheerioAPI): TableGrid | null {
  let section = "";
  let heading = "";
  for (const el of $("h3, h4, table").toArray()) {
    const text = el.tagName === "table" ? "" : normalizeSpace($(el).text());
    if (el.tagName === "h3") [section, heading] = [text, ""];
    else if (el.tagName === "h4") heading = text;
    else if (section === SECTION && PAYG_HEADING.test(heading)) return tableToGrid($, el);
  }
  return null;
}

export function parseHunyuanHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  const table = firstLanguageTable($);
  const rows = table ? parseTable(table, logger) : [];
  const groups = new Map<string, PriceRow[]>();
  for (const row of rows) groups.set(row.model, [...(groups.get(row.model) ?? []), row]);
  if (groups.size === 0)
    throw new PipelineError("E2001", "hunyuan：找不到「语言模型」下的混元价格表", {
      sourceId: SOURCE_ID,
    });
  const discounts = discountNotes($);
  return [...groups.values()].map((g) => toOffering(g, discounts));
}

export const hunyuanSource: Source = {
  id: SOURCE_ID,
  platform: "official-cn",
  kind: "html",
  timeoutMs: 60_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(HUNYUAN_URL, { timeoutMs: 45_000 });
    const offerings = parseHunyuanHtml(html, ctx.logger);
    ctx.logger.info("hunyuan 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
