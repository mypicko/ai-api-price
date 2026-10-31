import { describe, expect, it } from "vitest";
import { isLowOutlier, lowOutlierFields, median, OUTLIER_RATIO } from "../src/units";

const prices = (input: number | null, output: number | null) => ({
  input,
  output,
  cacheRead: null,
  cacheWrite: null,
});

describe("median", () => {
  it("奇数个取中间值，偶数个取中间两数的平均，空数组为 null", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("isLowOutlier：异常低价", () => {
  it(`比对照组中位数低 ${OUTLIER_RATIO} 倍以上才算异常`, () => {
    expect(isLowOutlier(0.07, [1.4, 1.4, 1.68])).toBe(true);
    expect(isLowOutlier(0.5, [1.4, 1.4, 1.68])).toBe(false);
  });

  it("和对照组里最便宜的一家持平时不算异常（真实低价，例如与官方价或 DeepInfra 相同）", () => {
    // grok-4.20：OpenRouter 与官方价相同，只是 OCI 贵得多
    expect(isLowOutlier(2.5, [15, 2.5])).toBe(false);
    // llama-3.3-70b：OpenRouter 与 DeepInfra 同价，中位数被一众贵平台拉高
    expect(isLowOutlier(0.1, [0.1, 0.5, 0.71, 0.72, 0.9])).toBe(false);
  });

  it("对照不足 2 个、价格缺失时不判定；对照组里的 null 和 0 不计入", () => {
    expect(isLowOutlier(0.01, [1.4])).toBe(false);
    expect(isLowOutlier(0.01, [1.4, null, 0])).toBe(false);
    expect(isLowOutlier(null, [1.4, 1.4])).toBe(false);
  });
});

describe("lowOutlierFields", () => {
  it("逐个检查输入价和输出价，返回异常的字段", () => {
    // GLM-5.3：OpenRouter 取了最便宜的小服务商，输入价只有主流的 1/20
    const peers = [prices(1.4, 4.4), prices(1.68, 5.28), prices(1.4, 4.4)];
    expect(lowOutlierFields(prices(0.0699, 1.4), peers)).toEqual(["input", "output"]);
    expect(lowOutlierFields(prices(0.192, 4.4), peers)).toEqual(["input"]);
    expect(lowOutlierFields(prices(1.2, 4), peers)).toEqual([]);
  });
});
