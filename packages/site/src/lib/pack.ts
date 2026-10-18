/**
 * 价格榜数据打包：上千条报价直接序列化成岛组件的 props 会让首页 HTML 达到几 MB。
 * 改成「按列存储 + 字符串字典」：平台名、厂商名、时间等重复字符串只存一次，浏览器端再还原。
 * 浏览器端运行，不能引入 zod。
 */
export interface PackedRows {
  readonly count: number;
  readonly keys: readonly string[];
  /** 每列的编码方式：dict = 字符串字典下标（-1 表示 null）；raw = 原值 */
  readonly kinds: readonly ("dict" | "raw")[];
  readonly dict: readonly string[];
  readonly columns: readonly (readonly unknown[])[];
}

type Row = Readonly<Record<string, unknown>>;

function isDictColumn(values: readonly unknown[]): boolean {
  return values.every((v) => v === null || typeof v === "string");
}

export function packRows<T extends object>(rows: readonly T[]): PackedRows {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const dict: string[] = [];
  const index = new Map<string, number>();
  const intern = (value: string): number => {
    const existing = index.get(value);
    if (existing !== undefined) return existing;
    index.set(value, dict.length);
    dict.push(value);
    return dict.length - 1;
  };
  const kinds = keys.map((key) =>
    isDictColumn(rows.map((r) => (r as Row)[key])) ? ("dict" as const) : ("raw" as const),
  );
  const columns = keys.map((key, i) =>
    rows.map((r) => {
      const value = (r as Row)[key];
      return kinds[i] === "dict" ? (value === null ? -1 : intern(value as string)) : value;
    }),
  );
  return { count: rows.length, keys, kinds, dict, columns };
}

export function unpackRows<T>(packed: PackedRows): T[] {
  return Array.from(
    { length: packed.count },
    (_, row) =>
      Object.fromEntries(
        packed.keys.map((key, i) => {
          const value = packed.columns[i]?.[row];
          if (packed.kinds[i] !== "dict") return [key, value];
          return [key, value === -1 ? null : packed.dict[value as number]];
        }),
      ) as T,
  );
}
