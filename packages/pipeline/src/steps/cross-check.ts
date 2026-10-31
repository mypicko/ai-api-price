/**
 * V7 交叉核对（DEV_DOCUMENT §3.5）：同一模型的官方价与 OpenRouter 价相差 > 30% 时记录 W3007，不拦截。
 * 比较前把两边换算成 USD；模型 ID 中的 "." 和 "-" 视为等价（claude-sonnet-4.5 ≈ claude-sonnet-4-5）。
 * V9 异常低价：OpenRouter 的模型价取的是最便宜那家服务商，输入/输出价比同模型其它平台的中位数
 * 低 3 倍以上时记录 W3009，不拦截（网站价差榜会跳过这类价格）。
 */
import {
  convertCurrency,
  convertPriceSet,
  lowOutlierFields,
  type Offering,
  type Warning,
} from "@aipb/shared";
import { makeWarning } from "./types";

export const CROSS_CHECK_THRESHOLD = 0.3;

const looseKey = (slug: string): string => slug.replace(/\./g, "-");

function relativeGap(official: number | null, other: number | null): number | null {
  if (official === null || other === null || official === 0) return null;
  return Math.abs(other - official) / official;
}

export function crossCheck(offerings: readonly Offering[], usdCny: number): readonly Warning[] {
  const live = offerings.filter((o) => o.status !== "removed");
  const openrouter = new Map(
    live.filter((o) => o.platform === "openrouter").map((o) => [looseKey(o.modelSlug), o] as const),
  );
  return live
    .filter((o) => o.platform === "official")
    .flatMap((official) => {
      const other = openrouter.get(looseKey(official.modelSlug));
      if (!other) return [];
      const gaps = (["input", "output"] as const).flatMap((field) => {
        const a = convertCurrency(official[field], official.currency, "USD", usdCny);
        const b = convertCurrency(other[field], other.currency, "USD", usdCny);
        const gap = relativeGap(a, b);
        return gap !== null && gap > CROSS_CHECK_THRESHOLD
          ? [`${field} ${Math.round(gap * 100)}%`]
          : [];
      });
      if (gaps.length === 0) return [];
      return [
        makeWarning("W3007", `官方价与 OpenRouter 价差过大：${gaps.join("，")}`, {
          offeringId: official.id,
        }),
      ];
    });
}

export function outlierCheck(offerings: readonly Offering[], usdCny: number): readonly Warning[] {
  const live = offerings.filter((o) => o.status !== "removed");
  const bySlug = new Map<string, Offering[]>();
  for (const o of live) bySlug.set(o.modelSlug, [...(bySlug.get(o.modelSlug) ?? []), o]);
  const toUsd = (o: Offering) => convertPriceSet(o, o.currency, "USD", usdCny);
  return live
    .filter((o) => o.platform === "openrouter")
    .flatMap((openrouter) => {
      const peers = (bySlug.get(openrouter.modelSlug) ?? [])
        .filter((o) => o.platform !== "openrouter")
        .map(toUsd);
      const fields = lowOutlierFields(toUsd(openrouter), peers);
      if (fields.length === 0) return [];
      return [
        makeWarning("W3009", `OpenRouter 价比其它平台中位数低 3 倍以上：${fields.join("，")}`, {
          offeringId: openrouter.id,
        }),
      ];
    });
}
