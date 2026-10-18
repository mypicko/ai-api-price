/** 纯日期（YYYY-MM-DD）运算，按 UTC 计算避免时区偏移 */
export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** 北京时间某天 00:00 对应的 Unix 秒 */
export function dateToUnix(date: string): number {
  return Date.parse(`${date}T00:00:00+08:00`) / 1000;
}

export function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}
