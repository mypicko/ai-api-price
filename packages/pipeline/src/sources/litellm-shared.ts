/** LiteLLM 文本与视频/图像解析共用的常量和工具 */

export const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export interface LitellmParseOptions {
  readonly today: string;
  /** 根据 vendorHint 返回厂商定价页；null 时用 LiteLLM 的 raw URL */
  readonly pricingUrlFor: (vendorHint: string) => string | null;
}

/** deprecation_date 早于今天的条目视为已弃用 */
export function isDeprecated(
  entry: { readonly deprecation_date?: string | undefined },
  today: string,
): boolean {
  const date = entry.deprecation_date;
  return date !== undefined && /^\d{4}-\d{2}-\d{2}/.test(date) && date.slice(0, 10) < today;
}
