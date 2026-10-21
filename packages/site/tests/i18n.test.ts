import { describe, expect, it } from "vitest";
import en from "../src/i18n/en.json";
import zh from "../src/i18n/zh.json";
import {
  createT,
  daysBetween,
  formatDate,
  formatDateTime,
  formatDateTimeWithZone,
  formatShortDateTime,
  formatShortDate,
  formatTime,
  formatTokenVolume,
  interpolate,
  messages,
  shanghaiDate,
  t,
} from "../src/lib/i18n";
import { DEFAULT_CURRENCY, isCurrency, isLocale } from "../src/lib/locale";

describe("i18n", () => {
  it("中英文两个文件的键完全一致", () => {
    expect(Object.keys(en).toSorted()).toEqual(Object.keys(zh).toSorted());
  });

  it("键名格式为 page.section.key", () => {
    for (const key of Object.keys(zh)) expect(key).toMatch(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9_]+)+$/);
  });

  it("替换占位符，缺失的变量保留原样", () => {
    expect(interpolate("此数据 {days} 天前更新", { days: 3 })).toBe("此数据 3 天前更新");
    expect(interpolate("{a} {b}", { a: "x" })).toBe("x {b}");
    expect(t("en", "stale.vendorNotice", { days: 8 })).toBe("⚠ Data may be outdated (8 days ago)");
    expect(createT("zh")("nav.home")).toBe("价格榜");
    expect(messages("en")["nav.home"]).toBe("Prices");
  });

  it("日期按北京时间显示", () => {
    // UTC 10-18 20:00 = 北京时间 10-19 04:00
    expect(shanghaiDate("2026-10-18T20:00:00Z")).toBe("2026-10-19");
    expect(shanghaiDate("2026-10-18")).toBe("2026-10-18");
    expect(formatDate("2026-10-18T20:00:00Z", "zh")).toBe("2026年10月19日");
    expect(formatDate("2026-10-19", "en")).toBe("Oct 19, 2026");
    expect(formatShortDate("2026-10-19", "zh")).toBe("10-19");
    expect(formatShortDate("2026-10-19", "en")).toBe("Oct 19");
    expect(formatTime("2026-10-19T00:04:12Z")).toBe("08:04");
    expect(formatDateTime("2026-10-19T00:04:12Z", "en")).toBe("Oct 19, 2026 08:04");
    // 静态页面构建后会被隔天打开，「今天」会过时，所以更新时间用带时区的完整时间
    expect(formatDateTimeWithZone("2026-10-22T03:02:00Z", "zh")).toBe(
      "2026年10月22日 11:02（北京时间 UTC+8）",
    );
    expect(formatDateTimeWithZone("2026-10-22T03:02:00Z", "en")).toBe(
      "Oct 22, 2026 11:02 (Beijing Time, UTC+8)",
    );
  });

  it("北京时间日期之间相差的天数", () => {
    expect(daysBetween("2026-10-16T00:04:00Z", "2026-10-19T00:04:12Z")).toBe(3);
    // UTC 前一天 20:00 已是北京时间当天 04:00
    expect(daysBetween("2026-10-18T20:00:00Z", "2026-10-19T03:00:00Z")).toBe(0);
  });

  it("表格短时间：月-日 时:分（北京时间），不用会过时的「今天」", () => {
    expect(formatShortDateTime("2026-10-21T22:44:00Z", "zh")).toBe("10-22 06:44");
    expect(formatShortDateTime("2026-10-21T22:44:00Z", "en")).toBe("Oct 22 06:44");
  });

  it("用量格式：中文万/亿，英文 K/M/B", () => {
    expect(formatTokenVolume(30_000_000, "zh")).toBe("3,000 万 tokens");
    expect(formatTokenVolume(150_000_000, "zh")).toBe("1.5 亿 tokens");
    expect(formatTokenVolume(500, "zh")).toBe("500 tokens");
    expect(formatTokenVolume(30_000_000, "en")).toBe("30M tokens");
    expect(formatTokenVolume(2_500_000_000, "en")).toBe("2.5B tokens");
    expect(formatTokenVolume(2_000, "en")).toBe("2K tokens");
    expect(formatTokenVolume(12, "en")).toBe("12 tokens");
  });

  it("语言和币种判断", () => {
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isCurrency("CNY")).toBe(true);
    expect(isCurrency("JPY")).toBe(false);
    expect(DEFAULT_CURRENCY.zh).toBe("CNY");
    expect(DEFAULT_CURRENCY.en).toBe("USD");
  });
});
