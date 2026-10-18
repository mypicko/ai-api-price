/**
 * 火山方舟（豆包）官方价格（官网价格页自己调用的公开匿名接口，无需登录）。
 * 页面：https://www.volcengine.com/pricing?product=ark_bd&tab=1
 * 接口（robots.txt 只禁止 /api/，这里是 /anonymous-api/）：
 *   1. POST GetNavigationV2 → 找到「火山方舟」Type=1（价格表）模板的 TemplateCode（失败时用已知的默认值）
 *   2. GET  ListTemplate?TemplateCode=… → 表格定义：chargeItem 列给出计费项（ConfigurationName = 模型、ChargeItemCode、Unit）
 *   3. POST GetTable {TemplateCode} → 每个 ChargeItemCode 的价格（PriceInfoList[0].Price，字符串）
 * 结构要点：
 * - ChargeItemCode 形如 Doubao_Seed_2.0_pro_32k_infer_input_cn-beijing_realtime：
 *   _infer_input_ / _infer_output_ / _infer_KVcache_hit_ 分别是输入 / 输出 / 缓存命中；
 *   含 (batch)、audio、storage 的是批量推理、音频输入、缓存存储，跳过；_32k_ / _128k_ / _256k_ 是输入长度档位
 * - 币种从价格列标题识别（"定价（单位：元/千tokens）"），单位从计费项 Unit 识别（"千tokens"）
 * - enum 列（上下文长度、服务类型）是给页面合并单元格用的，和计费项不是一一对应，不使用
 * - 第一版只取 Doubao 文本模型（排除 embedding、知识库、视频/图像/语音）
 * 最后核对：2026-10-18
 */
import type { RawOffering, RawTier } from "@aipb/shared";
import { z } from "zod";
import { PipelineError } from "../core/errors";
import type { HttpClient } from "../core/http";
import type { Logger } from "../core/logger";
import { detectCurrency, detectUnit } from "./parse-price";
import type { Source } from "./types";

export const VOLCENGINE_URL = "https://www.volcengine.com/pricing?product=ark_bd&tab=1";
const API = "https://www.volcengine.com/anonymous-api/trade/price";
export const NAVIGATION_URL = `${API}?Action=GetNavigationV2&Version=2020-01-01`;
export const GET_TABLE_URL = `${API}?Action=GetTable&Version=2020-01-01`;
export const DEFAULT_TEMPLATE_CODE = "CLTd9137gchmjlo0aojf5q0";
export const listTemplateUrl = (code: string): string =>
  `${API}?Action=ListTemplate&Version=2020-01-01&TemplateCode=${encodeURIComponent(code)}`;
const SOURCE_ID = "volcengine";

const ChargeItemSchema = z.object({
  ConfigurationName: z.string(),
  ChargeItemCode: z.string(),
  DisplayName: z.string().optional(),
  Unit: z.string().optional(),
});
type ChargeItem = z.infer<typeof ChargeItemSchema>;

const ColumnSchema = z
  .object({ Title: z.string().optional(), Type: z.string(), Data: z.unknown().optional() })
  .loose();
const FieldSchema = z
  .object({ Type: z.string(), Columns: z.array(ColumnSchema).optional() })
  .loose();
const TemplateSchema = z.object({ Fields: z.record(z.string(), FieldSchema) }).loose();
const ListTemplateSchema = z.object({
  Result: z.object({ List: z.array(z.object({ Template: z.string() }).loose()).min(1) }).loose(),
});
const GetTableSchema = z.object({
  Result: z
    .object({
      TableList: z.array(
        z
          .object({
            Rows: z.array(
              z
                .object({
                  ChargeItemCode: z.string(),
                  PriceInfoList: z.array(z.object({ Price: z.string() }).loose()),
                })
                .loose(),
            ),
          })
          .loose(),
      ),
    })
    .loose(),
});
const NavigationSchema = z.object({ Result: z.object({ Navigation: z.string() }).loose() });

type Kind = "input" | "output" | "cacheRead";

interface PricedItem {
  readonly model: string;
  readonly kind: Kind;
  readonly tierMaxK: number | null;
  readonly price: number;
  readonly currency: "CNY" | "USD";
  readonly unit: "per_token" | "per_1k" | "per_1m";
}

function classify(code: string): Kind | null {
  if (/\(batch\)|audio|storage/i.test(code)) return null;
  if (/_infer_input_/i.test(code)) return "input";
  if (/_infer_output_/i.test(code)) return "output";
  if (/_infer_KVcache_hit_/i.test(code)) return "cacheRead";
  return null;
}

function tierOf(code: string): number | null {
  const match = /_(\d+)k_infer_/i.exec(code);
  return match?.[1] ? Number(match[1]) : null;
}

function isTextModel(item: ChargeItem): boolean {
  return (
    /^doubao/i.test(item.ConfigurationName) &&
    !/embedding|知识库|seedance|seedream|tts|asr/i.test(
      `${item.ConfigurationName} ${item.DisplayName ?? ""}`,
    )
  );
}

/** 模板里所有 Table 字段：chargeItem 列的计费项 + 该表价格列标题 */
function collectChargeItems(templateJson: string): readonly (readonly [ChargeItem, string])[] {
  const template = TemplateSchema.parse(JSON.parse(templateJson));
  return Object.values(template.Fields).flatMap((field) => {
    if (field.Type !== "Table" || !field.Columns) return [];
    const priceTitle =
      field.Columns.find((c) => c.Type !== "chargeItem" && /定价|单价|价格/.test(c.Title ?? ""))
        ?.Title ?? "";
    return field.Columns.filter((c) => c.Type === "chargeItem").flatMap((c) => {
      const items = z.array(ChargeItemSchema.loose()).safeParse(c.Data);
      return items.success ? items.data.map((item) => [item, priceTitle] as const) : [];
    });
  });
}

function priceMap(table: unknown): ReadonlyMap<string, number> {
  const parsed = GetTableSchema.parse(table);
  const entries = parsed.Result.TableList.flatMap((t) =>
    t.Rows.flatMap((row) => {
      const value = Number(row.PriceInfoList[0]?.Price);
      return Number.isFinite(value) ? [[row.ChargeItemCode, value] as const] : [];
    }),
  );
  return new Map(entries);
}

function toPricedItem(
  item: ChargeItem,
  priceTitle: string,
  prices: ReadonlyMap<string, number>,
  logger?: Logger,
): PricedItem | null {
  const kind = classify(item.ChargeItemCode);
  const price = prices.get(item.ChargeItemCode);
  if (!kind || !isTextModel(item) || price === undefined) return null;
  const currency = detectCurrency(priceTitle);
  const unit = detectUnit(item.Unit ?? "") ?? detectUnit(priceTitle);
  if (!currency || !unit) {
    logger?.warn("volcengine：单位或币种无法识别，已跳过", {
      sourceId: SOURCE_ID,
      code: "W2003",
      item: item.ChargeItemCode,
      priceTitle,
    });
    return null;
  }
  return {
    model: item.ConfigurationName,
    kind,
    tierMaxK: tierOf(item.ChargeItemCode),
    price,
    currency,
    unit,
  };
}

function pick(items: readonly PricedItem[], kind: Kind, maxK: number | null): number | null {
  const ofKind = items.filter((i) => i.kind === kind);
  return (
    (ofKind.find((i) => i.tierMaxK === maxK) ?? ofKind.find((i) => i.tierMaxK === null))?.price ??
    null
  );
}

function buildTiers(items: readonly PricedItem[]): readonly RawTier[] {
  const bounds = [
    ...new Set(items.flatMap((i) => (i.tierMaxK === null ? [] : [i.tierMaxK]))),
  ].toSorted((a, b) => a - b);
  return bounds.map((maxK, index) => ({
    minInputTokens: index === 0 ? 0 : (bounds[index - 1] ?? 0) * 1000,
    maxInputTokens: maxK * 1000,
    input: pick(items, "input", maxK),
    output: pick(items, "output", maxK),
    cacheRead: pick(items, "cacheRead", maxK),
  }));
}

function toOffering(model: string, items: readonly PricedItem[]): RawOffering | null {
  const [first] = items;
  if (!first) return null;
  const tiers = buildTiers(items);
  const base = tiers[0];
  const input = base ? base.input : pick(items, "input", null);
  const output = base ? base.output : pick(items, "output", null);
  if (input === null && output === null) return null;
  return {
    vendorHint: "bytedance",
    modelName: model.toLowerCase(),
    displayName: model,
    currency: first.currency,
    unit: first.unit,
    input,
    output,
    cacheRead: base ? (base.cacheRead ?? null) : pick(items, "cacheRead", null),
    ...(tiers.length > 1 ? { tiers: [...tiers] } : {}),
    contextWindow: tiers.at(-1)?.maxInputTokens ?? null,
    sourceUrl: VOLCENGINE_URL,
  };
}

/** 纯函数：ListTemplate 响应 + GetTable 响应 → 报价 */
export function parseVolcengine(
  listTemplate: unknown,
  getTable: unknown,
  logger?: Logger,
): RawOffering[] {
  const list = ListTemplateSchema.safeParse(listTemplate);
  if (!list.success)
    throw new PipelineError("E2001", "volcengine：ListTemplate 响应结构变化", {
      sourceId: SOURCE_ID,
    });
  const prices = priceMap(getTable);
  const priced = list.data.Result.List.flatMap((entry) =>
    collectChargeItems(entry.Template).flatMap(([item, title]) => {
      const p = toPricedItem(item, title, prices, logger);
      return p ? [p] : [];
    }),
  );
  const groups = new Map<string, PricedItem[]>();
  for (const item of priced) groups.set(item.model, [...(groups.get(item.model) ?? []), item]);
  const offerings = [...groups.entries()].flatMap(([model, items]) => {
    const offering = toOffering(model, items);
    return offering ? [offering] : [];
  });
  if (offerings.length === 0)
    throw new PipelineError("E2001", "volcengine：没有找到 Doubao 文本模型的价格", {
      sourceId: SOURCE_ID,
    });
  return offerings;
}

interface NavNode {
  readonly TemplateInfoList?: readonly {
    readonly TemplateCode?: string;
    readonly Type?: number;
    readonly ZhName?: string;
  }[];
  readonly Children?: readonly NavNode[];
}

/** 在导航树里找「火山方舟」的价格表模板（Type = 1） */
export function findTemplateCode(navigation: unknown): string | null {
  const parsed = NavigationSchema.safeParse(navigation);
  if (!parsed.success) return null;
  const walk = (nodes: readonly NavNode[]): string | null => {
    for (const node of nodes) {
      const hit = node.TemplateInfoList?.find(
        (t) => t.Type === 1 && t.ZhName === "火山方舟" && t.TemplateCode,
      );
      if (hit?.TemplateCode) return hit.TemplateCode;
      const child = walk(node.Children ?? []);
      if (child) return child;
    }
    return null;
  };
  try {
    return walk(JSON.parse(parsed.data.Result.Navigation) as readonly NavNode[]);
  } catch {
    return null;
  }
}

async function postJson(http: HttpClient, url: string, body: unknown): Promise<unknown> {
  const response = await http.post(url, body);
  if (response.status < 200 || response.status >= 300) {
    throw new PipelineError("E1001", `HTTP ${response.status}：${url}`, { sourceId: SOURCE_ID });
  }
  try {
    return JSON.parse(response.text) as unknown;
  } catch (error) {
    throw new PipelineError("E2001", `volcengine：响应不是合法 JSON：${url}`, {
      sourceId: SOURCE_ID,
      cause: error,
    });
  }
}

async function resolveTemplateCode(http: HttpClient, logger: Logger): Promise<string> {
  try {
    const code = findTemplateCode(await postJson(http, NAVIGATION_URL, {}));
    if (code) return code;
    logger.warn("volcengine：导航里没有找到价格模板，使用默认 TemplateCode", {
      sourceId: SOURCE_ID,
    });
  } catch (error) {
    logger.warn("volcengine：导航接口失败，使用默认 TemplateCode", { sourceId: SOURCE_ID, error });
  }
  return DEFAULT_TEMPLATE_CODE;
}

export const volcengineSource: Source = {
  id: SOURCE_ID,
  platform: "official",
  kind: "api",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const code = await resolveTemplateCode(ctx.http, ctx.logger);
    const listTemplate = await ctx.http.getJson<unknown>(listTemplateUrl(code), {
      timeoutMs: 30_000,
    });
    const getTable = await postJson(ctx.http, GET_TABLE_URL, { TemplateCode: code });
    const offerings = parseVolcengine(listTemplate, getTable, ctx.logger);
    ctx.logger.info("volcengine 解析完成", {
      sourceId: SOURCE_ID,
      templateCode: code,
      count: offerings.length,
    });
    return offerings;
  },
};
