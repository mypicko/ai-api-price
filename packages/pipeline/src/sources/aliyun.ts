/**
 * 阿里云百炼（千问）官方价格（静态 HTML）。
 * 入口：https://www.alibabacloud.com/help/zh/model-studio/model-pricing
 *   （中国站 help.aliyun.com 在 2026-10-18 实测境外网络无法连接；国际站中文文档同样列出「华北2（北京）」地域价格，
 *    但以美元标价，所以 currency = USD）
 * 结构要点：
 * - 按「<h2>文本生成-千问</h2> → <h3>千问Max</h3> → <section><h4>华北2（北京）</h4> 表格…</section>」组织
 * - 只读 h2 以「文本生成」开头、且不是「第三方模型」的章节里，h4 为「华北2（北京）」的 section
 * - 表头：模型 ID | 模式 | 单次请求的输入Token数 | 输入单价（每百万Token）| 输出单价（每百万Token）[非思考 | 思考]
 *   多级表头时「输出单价」取第一个子列（非思考模式）
 * - 阶梯价：同一模型多行，「0<Token≤32K」「32K<Token≤128K」；「无阶梯计价」「不区分阶梯」= 单一价格
 * - 价格单元格可能是「原价$0.276（限时8折）」「忙时 $0.283闲时 $0.141」，取第一个数（原价 / 忙时价），优惠写进 notes
 * 最后核对：2026-10-18
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import * as cheerio from "cheerio";
import { PipelineError } from "../core/errors";
import type { Logger } from "../core/logger";
import {
  type HtmlElement,
  detectUnit,
  findColumn,
  findColumns,
  joinNotes,
  normalizeSpace,
  parseTokenRange,
  resolvePrice,
  type ResolvedPrice,
  type TableGrid,
  tableToGrid,
  type TokenRange,
  uniqueBy,
} from "./parse-price";
import type { Source } from "./types";

export const ALIYUN_URL = "https://www.alibabacloud.com/help/zh/model-studio/model-pricing";
const SOURCE_ID = "aliyun";
const REGION_HEADING = "华北2（北京）";
const MODEL_ID = /^[A-Za-z][\w.-]*$/;

interface Columns {
  readonly model: number;
  readonly tier: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

interface PriceRow {
  readonly model: string;
  readonly range: TokenRange | null;
  readonly input: ResolvedPrice | null;
  readonly output: ResolvedPrice | null;
  readonly cacheRead: number | null;
  readonly remarks: readonly string[];
}

function isTextGeneration(h2: string): boolean {
  return h2.startsWith("文本生成") && !h2.includes("第三方");
}

/** 按文档顺序找出「文本生成」章节下的北京地域 section */
function regionSections($: cheerio.CheerioAPI): readonly HtmlElement[] {
  let h2 = "";
  return $("h2, section")
    .toArray()
    .filter((el) => {
      if (el.tagName === "h2") {
        h2 = normalizeSpace($(el).text());
        return false;
      }
      return (
        normalizeSpace($(el).children("h4").first().text()) === REGION_HEADING &&
        isTextGeneration(h2)
      );
    });
}

function locateColumns(table: TableGrid): Columns | null {
  const required = findColumns(table.headers, {
    model: /模型\s*ID|Model ID/i,
    input: /^输入单价/,
    output: /^输出单价/,
  });
  if (!required) return null;
  const tier = findColumn(table.headers, /输入\s*Token\s*(数|范围)/i);
  const cacheRead = findColumn(table.headers, /缓存命中/);
  return { ...required, tier, cacheRead };
}

/** 第一个空白前的就是模型 ID，后面是「Batch调用半价」之类的说明 */
function modelIdOf(cell: string): string | null {
  const id = cell.split(" ")[0] ?? "";
  return MODEL_ID.test(id) ? id : null;
}

function remarksOf(cells: readonly string[]): readonly string[] {
  const text = cells.join(" ");
  return [
    /限时\s*\d+(\.\d+)?\s*折/.exec(text)?.[0]
      ? `部分价格${/限时\s*\d+(\.\d+)?\s*折/.exec(text)?.[0]}，表中为原价`
      : null,
    /闲时/.test(text) ? "闲时（东八区 22:00–次日 8:00）价格更低，表中为忙时价" : null,
  ].filter((r): r is string => r !== null);
}

function toPriceRow(
  row: readonly string[],
  columns: Columns,
  unitHint: ReturnType<typeof detectUnit>,
): PriceRow | null {
  const model = modelIdOf(row[columns.model] ?? "");
  if (!model) return null;
  const ctx = { sourceId: SOURCE_ID, unit: unitHint };
  const input = resolvePrice(row[columns.input] ?? "", ctx);
  const output = resolvePrice(row[columns.output] ?? "", ctx);
  if (!input && !output) return null;
  const tierText = columns.tier >= 0 ? (row[columns.tier] ?? "") : "";
  return {
    model,
    range: parseTokenRange(tierText),
    input,
    output,
    cacheRead:
      columns.cacheRead >= 0
        ? (resolvePrice(row[columns.cacheRead] ?? "", ctx)?.value ?? null)
        : null,
    remarks: remarksOf([row[columns.input] ?? "", row[columns.output] ?? ""]),
  };
}

function buildTiers(rows: readonly PriceRow[]): readonly RawTier[] {
  const ranged = uniqueBy(
    rows.filter((r) => r.range !== null),
    (r) => `${r.range?.min}-${r.range?.max}`,
  );
  return ranged.map((r) => ({
    minInputTokens: r.range?.min ?? 0,
    maxInputTokens: r.range?.max ?? null,
    input: r.input?.value ?? null,
    output: r.output?.value ?? null,
  }));
}

function toOffering(rows: readonly PriceRow[]): RawOffering {
  const [first] = rows;
  const reference = first?.input ?? first?.output;
  if (!first || !reference)
    throw new PipelineError("E2001", "aliyun：空的模型分组", { sourceId: SOURCE_ID });
  const tiers = buildTiers(rows);
  const notes = joinNotes(rows.flatMap((r) => r.remarks));
  return {
    vendorHint: "alibaba",
    modelName: first.model,
    currency: reference.currency,
    unit: reference.unit,
    input: first.input?.value ?? null,
    output: first.output?.value ?? null,
    ...(first.cacheRead === null ? {} : { cacheRead: first.cacheRead }),
    ...(tiers.length > 1 ? { tiers: [...tiers] } : {}),
    sourceUrl: ALIYUN_URL,
    ...(notes ? { notes } : {}),
  };
}

function parseTable(table: TableGrid, logger?: Logger): readonly PriceRow[] {
  const columns = locateColumns(table);
  if (!columns) return [];
  const unitHint = detectUnit(table.headers[columns.input] ?? "");
  return table.rows.flatMap((row) => {
    try {
      const parsed = toPriceRow(row, columns, unitHint);
      return parsed ? [parsed] : [];
    } catch (error) {
      logger?.warn("aliyun：跳过无法识别的价格行", {
        sourceId: SOURCE_ID,
        code: "W2003",
        row: row.join(" | "),
        error,
      });
      return [];
    }
  });
}

export function parseAliyunHtml(html: string, logger?: Logger): RawOffering[] {
  const $ = cheerio.load(html);
  const sections = regionSections($);
  if (sections.length === 0) {
    throw new PipelineError(
      "E2001",
      `aliyun：找不到「文本生成」下的「${REGION_HEADING}」价格区块`,
      { sourceId: SOURCE_ID },
    );
  }
  const rows = sections.flatMap((section) =>
    $(section)
      .find("table")
      .toArray()
      .flatMap((table) => parseTable(tableToGrid($, table), logger)),
  );
  const groups = new Map<string, PriceRow[]>();
  for (const row of rows) groups.set(row.model, [...(groups.get(row.model) ?? []), row]);
  const offerings = [...groups.values()].map(toOffering);
  if (offerings.length === 0)
    throw new PipelineError("E2001", "aliyun：价格区块里没有可识别的模型", { sourceId: SOURCE_ID });
  return offerings;
}

export const aliyunSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(ALIYUN_URL, { timeoutMs: 30_000 });
    const offerings = parseAliyunHtml(html, ctx.logger);
    ctx.logger.info("aliyun 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
