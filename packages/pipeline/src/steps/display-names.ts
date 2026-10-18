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

/** 名称质量：0 = 友好名称（与 ID 写法不同），1 = 带大小写的 ID 写法，2 = 原始 ID */
function nameQuality(displayName: string, model: string): number {
  if (isRawName(displayName, model)) return 2;
  return !/\s/.test(displayName) && normalizeModelId(displayName) === model ? 1 : 0;
}

/**
 * 视频/图像线：同一 modelSlug 的所有报价用同一个名称（表格里官方价和 OpenRouter 价并列，名称不同会像两个模型）。
 * 先比名称质量，再比平台优先级；例如官方的「MiniMax-H3-Max」和 OpenRouter 的「H3 Max」统一为「H3 Max」。
 */
export function unifyDisplayNames(offerings: readonly Offering[]): readonly Offering[] {
  const better = (a: Offering, b: Offering): boolean =>
    (nameQuality(a.displayName, a.model) - nameQuality(b.displayName, b.model) ||
      namePriority(a.platform) - namePriority(b.platform)) < 0;
  const best = new Map<string, Offering>();
  for (const o of offerings) {
    const current = best.get(o.modelSlug);
    if (!current || better(o, current)) best.set(o.modelSlug, o);
  }
  return offerings.map((o) => {
    const name = best.get(o.modelSlug)?.displayName ?? o.displayName;
    return name === o.displayName ? o : { ...o, displayName: name };
  });
}
