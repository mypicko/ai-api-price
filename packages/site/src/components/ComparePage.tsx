/**
 * 模型对比页（DEV §3.20）：最多 4 个模型并排，比较最低价、官方价、上下文、平台数。
 * 模型来自 ?m=（可分享的链接），没有时用本机的对比列表；数据读 data/board.json，不需要后端。
 */
import { useStore } from "@nanostores/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchBoardData } from "../lib/board-client";
import {
  MIN_COMPARE,
  compareColumns,
  compareSearch,
  parseCompareSearch,
  type CompareColumn,
} from "../lib/compare";
import { createT, type MessageKey } from "../lib/i18n";
import type { Locale } from "../lib/locale";
import { unpackRows } from "../lib/pack";
import { formatTokens } from "../lib/shared-client";
import type { TableRow } from "../lib/table";
import { modelPath, pageHref } from "../lib/url";
import { $compare, toggleCompare } from "../stores/collections";
import { PctBadge } from "./ChangeBadge";
import { useCollections } from "./CollectionButtons";
import { DualPrice } from "./DualPrice";

export interface ComparePageProps {
  readonly locale: Locale;
  readonly base: string;
  readonly dataUrl: string;
  readonly fxNote: string;
}

type Load =
  { state: "loading" } | { state: "error" } | { state: "done"; rows: readonly TableRow[] };

function useRows(url: string): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetchBoardData(url)
      .then((data) => {
        if (!cancelled) setLoad({ state: "done", rows: unpackRows<TableRow>(data.packedRows) });
      })
      .catch((error: unknown) => {
        console.error("对比数据加载失败", error);
        if (!cancelled) setLoad({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return load;
}

/** 选中的模型：?m= 优先，其次本机对比列表；变化时同步到地址栏 */
function useSlugs(): [readonly string[] | null, (next: readonly string[]) => void] {
  useCollections();
  const stored = useStore($compare);
  const [fromUrl, setFromUrl] = useState<readonly string[] | null>(null);
  useEffect(() => setFromUrl(parseCompareSearch(window.location.search)), []);
  const slugs = fromUrl === null ? null : fromUrl.length > 0 ? fromUrl : stored;
  const update = (next: readonly string[]): void => {
    setFromUrl(next);
    const url = `${window.location.pathname}${compareSearch(next)}`;
    window.history.replaceState(window.history.state, "", url);
  };
  return [slugs, update];
}

function Price({
  row,
  index,
  props,
}: {
  row: TableRow | null;
  index: 0 | 1 | 2;
  props: ComparePageProps;
}) {
  const t = createT(props.locale);
  if (!row) return <span className="text-text-faint">—</span>;
  return (
    <div className="flex flex-col items-start">
      <span className="font-medium tabular">
        <DualPrice
          currency={row.currency}
          usd={row.usd[index]}
          cny={row.cny[index]}
          locale={props.locale}
          fxNote={props.fxNote}
        />
      </span>
      <span className="text-micro text-text-muted">
        {t("compare.via", { platform: row.platformName })}
      </span>
    </div>
  );
}

function InOut({ row, props }: { row: TableRow | null; props: ComparePageProps }) {
  const t = createT(props.locale);
  if (!row) return <span className="text-text-faint">—</span>;
  const price = (index: 0 | 1) => (
    <DualPrice
      currency={row.currency}
      usd={row.usd[index]}
      cny={row.cny[index]}
      locale={props.locale}
      fxNote={props.fxNote}
    />
  );
  return (
    <div className="flex flex-col items-start">
      <span className="tabular">
        {price(0)} / {price(1)}
      </span>
      <span className="text-micro text-text-muted">
        {t("compare.via", { platform: row.platformName })}
      </span>
    </div>
  );
}

interface Line {
  readonly label: MessageKey;
  readonly render: (c: CompareColumn) => ReactNode;
}

function lines(props: ComparePageProps): readonly Line[] {
  const t = createT(props.locale);
  return [
    { label: "compare.row.vendor", render: (c) => c.vendorName },
    { label: "compare.row.best", render: (c) => <InOut row={c.best} props={props} /> },
    {
      label: "compare.row.bestInput",
      render: (c) => <Price row={c.bestInput} index={0} props={props} />,
    },
    {
      label: "compare.row.bestOutput",
      render: (c) => <Price row={c.bestOutput} index={1} props={props} />,
    },
    {
      label: "compare.row.bestCache",
      render: (c) => <Price row={c.bestCache} index={2} props={props} />,
    },
    { label: "compare.row.official", render: (c) => <InOut row={c.official} props={props} /> },
    {
      label: "compare.row.context",
      render: (c) =>
        c.contextWindow === null ? (
          <span className="text-text-faint">—</span>
        ) : (
          <span className="tabular">{formatTokens(c.contextWindow)}</span>
        ),
    },
    {
      label: "compare.row.platforms",
      render: (c) => <span className="tabular">{c.platformCount}</span>,
    },
    {
      label: "compare.row.change7d",
      render: (c) => <PctBadge pct={c.best.change7d} locale={props.locale} />,
    },
    {
      label: "compare.row.details",
      render: (c) => (
        <a className="link" href={pageHref(props.base, props.locale, modelPath(c.slug))}>
          {t("compare.viewDetails")}
        </a>
      ),
    },
  ];
}

function CopyLink({ locale }: { locale: Locale }) {
  const t = createT(locale);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = (): void => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => setStatus("copied"))
      .catch((error: unknown) => {
        console.warn("复制对比链接失败", error);
        setStatus("failed");
      });
  };
  return (
    <button type="button" className="btn" onClick={copy} data-testid="compare-copy">
      {status === "copied"
        ? t("compare.copied")
        : status === "failed"
          ? t("compare.copyFailed")
          : t("compare.copy")}
    </button>
  );
}

function Empty({ props }: { props: ComparePageProps }) {
  const t = createT(props.locale);
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center text-text-muted"
      data-testid="compare-empty"
    >
      <p>{t("compare.empty")}</p>
      <a className="btn btn-primary" href={pageHref(props.base, props.locale, "")}>
        {t("compare.backToBoard")}
      </a>
    </div>
  );
}

export function ComparePage(props: ComparePageProps) {
  const t = createT(props.locale);
  const load = useRows(props.dataUrl);
  const [slugs, setSlugs] = useSlugs();
  const result = useMemo(
    () => (load.state === "done" && slugs ? compareColumns(load.rows, slugs) : null),
    [load, slugs],
  );
  if (load.state === "error") return <p className="text-warn">{t("board.loadError")}</p>;
  if (!result || slugs === null) return <p className="text-text-muted">{t("board.loading")}</p>;
  if (result.columns.length === 0 && result.missing.length === 0) return <Empty props={props} />;
  const remove = (slug: string): void => {
    setSlugs(slugs.filter((s) => s !== slug));
    if ($compare.get().includes(slug)) toggleCompare(slug);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CopyLink locale={props.locale} />
        {result.columns.length < MIN_COMPARE && (
          <span className="text-small text-text-muted">{t("compare.needMore")}</span>
        )}
      </div>
      {result.missing.length > 0 && (
        <p className="text-small text-warn" data-testid="compare-missing">
          {t("compare.missing", { slugs: result.missing.join(", ") })}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-table" data-testid="compare-table">
          <caption className="sr-only">{t("compare.title")}</caption>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="w-40 px-3 py-2 text-left text-small text-text-muted">
                <span className="sr-only">{t("compare.title")}</span>
              </th>
              {result.columns.map((c) => (
                <th key={c.slug} scope="col" className="min-w-44 px-3 py-2 text-left align-top">
                  <div className="font-semibold">{c.displayName}</div>
                  <div className="font-mono text-micro font-normal text-text-faint">{c.slug}</div>
                  <button
                    type="button"
                    className="mt-1 text-micro font-normal text-text-muted hover:text-text"
                    onClick={() => remove(c.slug)}
                  >
                    × {t("compare.removeModel")}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines(props).map((line) => (
              <tr key={line.label} className="border-t border-border align-top">
                <th
                  scope="row"
                  className="px-3 py-2.5 text-left text-small font-normal text-text-muted"
                >
                  {t(line.label)}
                </th>
                {result.columns.map((c) => (
                  <td key={c.slug} className="px-3 py-2.5">
                    {line.render(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-micro text-text-faint">{t("compare.unit")}</p>
    </div>
  );
}
