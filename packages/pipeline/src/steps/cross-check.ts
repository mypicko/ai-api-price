/**
 * V7 交叉核对（DEV_DOCUMENT §3.5）：同一模型的官方价与 OpenRouter 价相差 > 30% 时记录 W3007，不拦截。
 * 比较前把两边换算成 USD；模型 ID 中的 "." 和 "-" 视为等价（claude-sonnet-4.5 ≈ claude-sonnet-4-5）。
 */
import { convertCurrency, type Offering, type Warning } from "@aipb/shared";
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
