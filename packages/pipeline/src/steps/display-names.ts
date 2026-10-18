/**
 * 统一展示名：LiteLLM 只有原始模型 ID（如 "claude-sonnet-4-5"），
 * 同一个 modelSlug 在其他平台（如 OpenRouter）有更友好的名称时借用它。
 */
import { normalizeModelId, type Offering } from "@aipb/shared";

/** 展示名只是模型 ID 的另一种写法（全小写、无空格，规范化后等于 ID） */
export function isRawName(displayName: string, model: string): boolean {
  return (
    displayName === displayName.toLowerCase() &&
    !/\s/.test(displayName) &&
    normalizeModelId(displayName) === model
  );
}

/** 名称来源优先级：官方 > OpenRouter > 其他聚合平台 */
const NAME_PRIORITY: readonly string[] = ["official", "openrouter"];

function namePriority(platform: string): number {
  const index = NAME_PRIORITY.indexOf(platform);
  return index === -1 ? NAME_PRIORITY.length : index;
}

export function harmonizeDisplayNames(offerings: readonly Offering[]): readonly Offering[] {
  const friendly = new Map<string, string>();
  const ordered = offerings.toSorted((a, b) => namePriority(a.platform) - namePriority(b.platform));
  for (const o of ordered) {
    if (!friendly.has(o.modelSlug) && !isRawName(o.displayName, o.model)) {
      friendly.set(o.modelSlug, o.displayName);
    }
  }
  return offerings.map((o) => {
    const better = friendly.get(o.modelSlug);
    return better !== undefined && isRawName(o.displayName, o.model)
      ? { ...o, displayName: better }
      : o;
  });
}
