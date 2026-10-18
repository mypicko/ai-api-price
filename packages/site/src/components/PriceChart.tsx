/**
 * 价格走势图（STYLE §9）：uPlot 阶梯线，Y 轴从 0 开始；输出实线、输入虚线；平台按类别色区分。
 * 悬停时图例显示该日期所有序列的数值；点击图例隐藏某条线。
 */
import type { Currency } from "@aipb/shared";
import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { DEFAULT_CURRENCY, type Locale } from "../lib/locale";
import {
  RANGES,
  buildChartData,
  changeAt,
  type ChartData,
  type ChartOffering,
  type ChartRange,
} from "../lib/chart";
import { TIME_ZONE, createT, formatShortDate } from "../lib/i18n";
import { currencySymbol, formatPct, formatPrice } from "../lib/shared-client";
import { $currency, isDarkMode } from "../stores/prefs";

export interface PriceChartProps {
  readonly offerings: readonly ChartOffering[];
  readonly locale: Locale;
  readonly usdCny: number;
  readonly endDate: string;
}

const HEIGHT = 280;

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartColor(index: number): string {
  return cssVar(`--color-chart-${(index % 8) + 1}`);
}

function buildOptions(
  data: ChartData,
  props: PriceChartProps,
  currency: Currency,
  width: number,
): uPlot.Options {
  const t = createT(props.locale);
  const text = cssVar("--color-text-muted");
  const grid = cssVar("--color-border");
  const axis = {
    stroke: text,
    grid: { stroke: grid, width: 1 },
    ticks: { stroke: grid, width: 1 },
    font: "12px var(--font-sans)",
  };
  const stepped = uPlot.paths.stepped?.({ align: 1 });
  return {
    width,
    height: HEIGHT,
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), TIME_ZONE),
    cursor: { points: { size: 6 } },
    legend: { live: true },
    scales: { x: { time: true }, y: { range: (_u, _min, max) => [0, max > 0 ? max * 1.15 : 1] } },
    axes: [
      {
        ...axis,
        values: (_u, splits) =>
          splits.map((s) => formatShortDate(new Date(s * 1000).toISOString(), props.locale)),
      },
      {
        ...axis,
        label: t("chart.axis", { symbol: currencySymbol(currency) }),
        labelFont: "12px var(--font-sans)",
        size: 64,
        values: (_u, splits) =>
          splits.map((s) =>
            formatPrice(s, currency, { locale: props.locale }).replace(/^(免费|Free)$/, "0"),
          ),
      },
    ],
    series: [
      {
        label: t("chart.table.date"),
        value: (_u, v) =>
          v === null ? "—" : formatShortDate(new Date(v * 1000).toISOString(), props.locale),
      },
      ...data.series.map((s): uPlot.Series => {
        const color = chartColor(s.colorIndex);
        return {
          label: `${s.label} · ${t(s.field === "input" ? "chart.input" : "chart.output")}`,
          stroke: color,
          width: 2,
          dash: s.field === "input" ? [5, 4] : [],
          spanGaps: false,
          ...(stepped ? { paths: stepped } : {}),
          points: {
            show: true,
            size: 6,
            fill: color,
            stroke: color,
            filter: () => [...s.changeIndexes],
          },
          value: (_u, v, _si, idx) => {
            if (v === null || v === undefined) return "—";
            const price = formatPrice(v, currency, { locale: props.locale });
            const pct = idx !== null && s.changeIndexes.includes(idx) ? changeAt(s, idx) : null;
            return pct === null ? price : `${price}（${pct < 0 ? "▼" : "▲"} ${formatPct(pct)}）`;
          },
        };
      }),
    ],
  };
}

function toAligned(data: ChartData): uPlot.AlignedData {
  return [[...data.xs], ...data.series.map((s) => [...s.values])];
}

export function PriceChart(props: PriceChartProps) {
  const t = createT(props.locale);
  const container = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<ChartRange>("all");
  const [themeTick, setThemeTick] = useState(0);
  const stored = useStore($currency);
  const currency = stored ?? DEFAULT_CURRENCY[props.locale];

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeTick((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return undefined;
    const data = buildChartData(props.offerings, {
      currency,
      usdCny: props.usdCny,
      endDate: props.endDate,
      range,
    });
    el.replaceChildren();
    const plot = new uPlot(
      buildOptions(data, props, currency, el.clientWidth || 600),
      toAligned(data),
      el,
    );
    plot.root.dataset["theme"] = isDarkMode() ? "dark" : "light";
    const resize = new ResizeObserver(() =>
      plot.setSize({ width: el.clientWidth, height: HEIGHT }),
    );
    resize.observe(el);
    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [props, currency, range, themeTick]);

  return (
    <div className="flex flex-col gap-3" data-testid="price-chart">
      <div role="group" aria-label={t("chart.range")} className="segmented self-start">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
            {t(`chart.range.${r}`)}
          </button>
        ))}
      </div>
      <div ref={container} className="aipb-chart min-h-[340px] w-full">
        <p className="py-24 text-center text-small text-text-muted">{t("chart.loading")}</p>
      </div>
    </div>
  );
}
