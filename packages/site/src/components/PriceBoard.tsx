/**
 * 首页价格榜：文本模型 / 视频 / 图像三个标签在同一位置切换（DEV §3.10）。
 * 计价单位不同（每百万 tokens / 每秒 / 每张），所以各自一张表，不混排。
 * 标签记在 ?kind= 里，?q= 在标签之间共用；首屏在构建时渲染文本标签。
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { MediaKind } from "@aipb/shared";
import { BOARD_TABS, boardTabSearch, parseBoardTab, type BoardTab } from "../lib/board";
import { createT } from "../lib/i18n";
import { countByKind, type MediaRow } from "../lib/media";
import { unpackRows, type PackedRows } from "../lib/pack";
import type { TableRow } from "../lib/table";
import type { PlanRow } from "../lib/plans";
import { MediaTable } from "./MediaTable";
import { PlansTable } from "./PlansTable";
import { PriceTable, type PriceTableProps } from "./PriceTable";

export interface PriceBoardProps extends Omit<PriceTableProps, "rows"> {
  /** 文本报价，按列打包以减小首页 HTML（见 lib/pack.ts） */
  readonly packedRows: PackedRows;
  readonly mediaRows: readonly MediaRow[];
  /** 编程套餐（Coding Plan） */
  readonly planRows: readonly PlanRow[];
}

function replaceSearch(search: string): void {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

function TabList(props: {
  tab: BoardTab;
  counts: Readonly<Record<BoardTab, number>>;
  locale: PriceTableProps["locale"];
  onChange: (tab: BoardTab) => void;
}) {
  const t = createT(props.locale);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const index = (BOARD_TABS.indexOf(props.tab) + step + BOARD_TABS.length) % BOARD_TABS.length;
    const next = BOARD_TABS[index] ?? "text";
    props.onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={t("board.tabs")}
      className="flex gap-1 border-b border-border"
      onKeyDown={onKeyDown}
      data-testid="board-tabs"
    >
      {BOARD_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`board-tab-${tab}`}
          data-tab={tab}
          aria-selected={props.tab === tab}
          aria-controls="board-panel"
          tabIndex={props.tab === tab ? 0 : -1}
          onClick={() => props.onChange(tab)}
          className="-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-body text-text-muted hover:text-text aria-selected:border-accent aria-selected:font-semibold aria-selected:text-text"
        >
          {t(`board.tab.${tab}`)}
          <span className="rounded-sm bg-surface px-1.5 text-micro tabular text-text-muted">
            {props.counts[tab]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PriceBoard(props: PriceBoardProps) {
  const { mediaRows, packedRows, planRows, ...rest } = props;
  const rows = useMemo(() => unpackRows<TableRow>(packedRows), [packedRows]);
  const tableProps: PriceTableProps = { ...rest, rows };
  const [tab, setTab] = useState<BoardTab>("text");
  useEffect(() => setTab(parseBoardTab(window.location.search)), []);
  const counts = useMemo(
    () => ({ text: rows.length, ...countByKind(mediaRows), plans: planRows.length }),
    [rows, mediaRows, planRows],
  );
  const select = (next: BoardTab, query?: string): void => {
    const search = query === undefined ? window.location.search : `?q=${encodeURIComponent(query)}`;
    replaceSearch(boardTabSearch(search, next));
    setTab(next);
  };
  const onSelectMedia = (kind: MediaKind, query: string): void => select(kind, query);
  // 没有视频/图像和套餐数据时不显示标签，保持原来的单表样式
  if (mediaRows.length === 0 && planRows.length === 0) return <PriceTable {...tableProps} />;
  return (
    <div className="flex flex-col gap-4">
      <TabList tab={tab} counts={counts} locale={props.locale} onChange={(next) => select(next)} />
      <div id="board-panel" role="tabpanel" aria-labelledby={`board-tab-${tab}`}>
        {tab === "text" ? (
          <PriceTable {...tableProps} onSelectMedia={onSelectMedia} />
        ) : tab === "plans" ? (
          <PlansTable rows={planRows} locale={props.locale} fxNote={props.fxNote} />
        ) : (
          <MediaTable
            rows={mediaRows}
            locale={props.locale}
            nowIso={props.nowIso}
            fxNote={props.fxNote}
            kind={tab}
          />
        )}
      </div>
    </div>
  );
}
