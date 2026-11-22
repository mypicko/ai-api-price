/**
 * 阶跃星辰国内站人民币价格（Mintlify 文档站，静态 HTML，服务端渲染）。
 * 入口：https://platform.stepfun.com/docs/zh/guides/pricing/details
 *   （旧地址 /docs/zh/pricing/details 跳转到这里）。原来国内价只有 models.dev 社区数据（美元换算），现在以本抓取器为准。
 * 结构要点：
 * - 「文本与多模态模型」表：Model ID | 输入价格（缓存未命中）| 输入价格（缓存命中）| 输出价格，单位写在表上方「元／百万 tokens」
 * - 只取第一张这样的表：后面「实时语音与语音对话（按 Token 计费）」表头相同但是语音模型；其余语音表按分钟 / 字符计价
 * 最后核对：2026-11-22
 */
import type { RawOffering } from "@aipb/shared";
import { PipelineError } from "../core/errors";
import { findColumn, findColumns, normalizeSpace, readHtmlTables, uniqueBy } from "./parse-price";
import type { Source } from "./types";

export const STEPFUN_CN_URL = "https://platform.stepfun.com/docs/zh/guides/pricing/details";
const SOURCE_ID = "stepfun-cn";
const NUMBER = /^\d+(?:\.\d+)?$/;

const priceOf = (cell: string | undefined): number | null => {
  const text = normalizeSpace(cell ?? "")
    .replace(/元.*$/, "")
    .trim();
  return NUMBER.test(text) ? Number(text) : null;
};

export function parseStepfunCnHtml(html: string): RawOffering[] {
  // 只取第一张符合的表（文本与多模态模型）；后面「实时语音与语音对话（按 Token 计费）」表头相同，是语音模型，不收
  const table = readHtmlTables(html).find((t) =>
    findColumns(t.headers, { model: /^Model ID/i, output: /^输出价格/ }),
  );
  const offerings = (table ? [table] : []).flatMap((table) => {
    const columns = findColumns(table.headers, {
      model: /^Model ID/i,
      input: /^输入价格（缓存未命中）|^输入价格$/,
      output: /^输出价格/,
    });
    if (!columns) return [];
    const cacheRead = findColumn(table.headers, /缓存命中/);
    return table.rows.flatMap((row): RawOffering[] => {
      const model = normalizeSpace(row[columns.model] ?? "");
      const input = priceOf(row[columns.input]);
      const output = priceOf(row[columns.output]);
      if (!/^step/i.test(model) || (input === null && output === null)) return [];
      const cache = cacheRead >= 0 ? priceOf(row[cacheRead]) : null;
      return [
        {
          vendorHint: "stepfun",
          modelName: model,
          displayName: model,
          currency: "CNY",
          unit: "per_1m",
          input,
          output,
          ...(cache === null ? {} : { cacheRead: cache }),
          sourceUrl: STEPFUN_CN_URL,
        },
      ];
    });
  });
  if (offerings.length === 0)
    throw new PipelineError("E2001", "stepfun-cn：找不到文本模型价格表", { sourceId: SOURCE_ID });
  return uniqueBy(offerings, (o) => o.modelName);
}

export const stepfunCnSource: Source = {
  id: SOURCE_ID,
  platform: "official-cn",
  kind: "html",
  timeoutMs: 45_000,
  async fetch(ctx) {
    const html = await ctx.http.getText(STEPFUN_CN_URL, { timeoutMs: 30_000 });
    const offerings = parseStepfunCnHtml(html);
    ctx.logger.info("stepfun-cn 解析完成", { sourceId: SOURCE_ID, count: offerings.length });
    return offerings;
  },
};
