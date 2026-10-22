/**
 * 首页价格榜数据（DEV §3.19）：全量数据单独生成 data/board.json，首页 HTML 只内嵌首屏需要的部分。
 * 首屏 = 默认视图（按模型聚合、混合价升序）下前 PAGE_SIZE 个模型的全部报价，展开平台明细也不缺数据。
 * 浏览器空闲时再取 board.json 换成全量；对比页也读这份文件。
 */
import { groupByModel, sortGroups } from "./aggregate";
import type { Locale } from "./locale";
import { countByKind, toMediaSearchItem, type MediaRow, type MediaSearchItem } from "./media";
import { packRows, type PackedRows } from "./pack";
import { toPlanRows, type PlanRow } from "./plans";
import { toMediaTableRow, toTableRow, type SiteModel } from "./site-model";
import { DEFAULT_SORT, PAGE_SIZE, type TableRow } from "./table";

export interface BoardData {
  readonly packedRows: PackedRows;
  readonly mediaRows: readonly MediaRow[];
  readonly media: readonly MediaSearchItem[];
  readonly planRows: readonly PlanRow[];
}

/** 标签上显示的条数（全量数据到达前也要显示正确的数字） */
export interface BoardCounts {
  readonly text: number;
  readonly video: number;
  readonly image: number;
  readonly plans: number;
}

/** 全量数据文件相对路径（不含 base、不含语言前缀） */
export const BOARD_DATA_PATH = "data/board.json";

export function boardTableRows(model: SiteModel, locale: Locale): readonly TableRow[] {
  return model.offerings.map((o) => toTableRow(model, o, locale));
}

export function boardData(model: SiteModel, locale: Locale): BoardData {
  const mediaRows = model.media.offerings.map((o) => toMediaTableRow(model, o, locale));
  return {
    packedRows: packRows(boardTableRows(model, locale)),
    mediaRows,
    media: mediaRows.map(toMediaSearchItem),
    planRows: toPlanRows(model, model.data.plans, locale),
  };
}

export function boardCounts(data: BoardData): BoardCounts {
  return {
    text: data.packedRows.count,
    ...countByKind(data.mediaRows),
    plans: data.planRows.length,
  };
}

/** 首屏报价：默认排序下前 limit 个模型的全部报价 */
export function initialRows(rows: readonly TableRow[], limit = PAGE_SIZE): readonly TableRow[] {
  const top = sortGroups(groupByModel(rows), DEFAULT_SORT).slice(0, limit);
  const keep = new Set(top.map((g) => g.id));
  return rows.filter((r) => keep.has(r.modelSlug));
}
