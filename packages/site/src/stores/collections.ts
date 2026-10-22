/**
 * 收藏和对比列表（DEV §3.20）：modelSlug 数组，存在 localStorage，跨页面、跨标签页同步。
 * 构建时渲染的 HTML 里没有收藏状态，所以初始为空，水合后由 initCollections() 读入，避免水合不一致。
 */
import { atom } from "nanostores";
import {
  MAX_COMPARE,
  MAX_FAVORITES,
  cleanSlugs,
  parseStoredSlugs,
  toggleSlug,
} from "../lib/compare";

export const COLLECTION_KEYS = {
  favorites: "aipb.favorites",
  compare: "aipb.compare",
} as const;

export const $favorites = atom<readonly string[]>([]);
export const $compare = atom<readonly string[]>([]);

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (error) {
    console.warn("localStorage 不可用，收藏和对比不会保存", error);
    return null;
  }
}

function save(key: string, list: readonly string[]): void {
  try {
    storage()?.setItem(key, JSON.stringify(list));
  } catch (error) {
    console.warn("保存收藏/对比失败", error);
  }
}

function read(): void {
  const store = storage();
  $favorites.set(
    parseStoredSlugs(store?.getItem(COLLECTION_KEYS.favorites) ?? null, MAX_FAVORITES),
  );
  $compare.set(parseStoredSlugs(store?.getItem(COLLECTION_KEYS.compare) ?? null, MAX_COMPARE));
}

let initialized = false;

/** 水合后调用；多次调用只初始化一次。其他标签页改了列表时同步过来 */
export function initCollections(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  read();
  window.addEventListener("storage", (event) => {
    if (event.key === COLLECTION_KEYS.favorites || event.key === COLLECTION_KEYS.compare) read();
  });
}

export function toggleFavorite(slug: string): void {
  const next = toggleSlug($favorites.get(), slug, MAX_FAVORITES);
  $favorites.set(next);
  save(COLLECTION_KEYS.favorites, next);
}

/** 已满（4 个）时不加入，返回 false */
export function toggleCompare(slug: string): boolean {
  const current = $compare.get();
  const next = toggleSlug(current, slug, MAX_COMPARE);
  if (next === current) return false;
  $compare.set(next);
  save(COLLECTION_KEYS.compare, next);
  return true;
}

export function setCompare(slugs: readonly string[]): void {
  const next = cleanSlugs(slugs, MAX_COMPARE);
  $compare.set(next);
  save(COLLECTION_KEYS.compare, next);
}
