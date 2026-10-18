/** 键排序后的 JSON：用于比较内容是否相同，与对象键的插入顺序无关 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return Object.fromEntries(
    entries
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortKeysDeep(v)]),
  );
}
