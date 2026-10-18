/**
 * 价格榜标签：文本模型 / 视频 / 图像在首页同一个位置切换（DEV §3.10）。
 * 标签记在 ?kind= 里（缺省 = 文本），搜索关键字 ?q= 在标签之间共用。
 * 浏览器端运行，不能引入 zod。
 */
import type { MediaKind } from "@aipb/shared";

export type BoardTab = "text" | MediaKind;

export const BOARD_TABS: readonly BoardTab[] = ["text", "video", "image"];

export function parseBoardTab(search: string): BoardTab {
  const kind = new URLSearchParams(search).get("kind");
  return kind === "video" || kind === "image" ? kind : "text";
}

/** 切换到 tab 后的查询串（含 ?，为空时返回 ""）：只保留关键字，清掉另一张表的筛选和排序参数 */
export function boardTabSearch(search: string, tab: BoardTab): string {
  const query = (new URLSearchParams(search).get("q") ?? "").trim();
  const next = new URLSearchParams();
  if (tab !== "text") next.set("kind", tab);
  if (query !== "") next.set("q", query);
  const text = next.toString();
  return text === "" ? "" : `?${text}`;
}
