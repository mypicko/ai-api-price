/**
 * 时间工具：「今天」一律按 Asia/Shanghai 计算（DEV_DOCUMENT §7 TZ），存储一律 ISO UTC。
 * 所有函数都接收注入的 now，不直接调用 new Date()（STYLE §12）。
 */
export const TIME_ZONE = "Asia/Shanghai";

const DAY_MS = 86_400_000;

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 北京时间的日期 YYYY-MM-DD */
export function shanghaiDate(now: Date): string {
  return DATE_FORMAT.format(now);
}

/** "2026-10-18" → "2026-10" */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 两个时间点之间相差的整天数（向下取整，from 晚于 to 时为 0） */
export function daysBetween(fromIso: string, to: Date): number {
  const diff = to.getTime() - new Date(fromIso).getTime();
  return diff <= 0 ? 0 : Math.floor(diff / DAY_MS);
}

/** 去掉毫秒，和接口示例保持一致：2026-10-19T00:04:12Z */
export function toIsoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
