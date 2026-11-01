/**
 * 本地后台的 HTML 小工具：页面骨架、样式、表格、徽章、SVG 柱状图。所有文字都经过转义。
 */
import { escapeHtml } from "../notify/format";

export const esc = (value: string | number | null | undefined): string =>
  escapeHtml(value === null || value === undefined ? "—" : String(value));

export type Tone = "ok" | "warn" | "bad" | "muted";

export function badge(text: string, tone: Tone): string {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

/** cells 里的内容视为已经转义好的 HTML */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return `<p class="empty">暂无</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export function stat(label: string, value: string | number, hint = ""): string {
  return `<div class="stat"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div>${hint ? `<div class="stat-hint">${esc(hint)}</div>` : ""}</div>`;
}

export function section(id: string, title: string, body: string, note = ""): string {
  return `<section id="${id}"><h2>${esc(title)}</h2>${note ? `<p class="note">${esc(note)}</p>` : ""}${body}</section>`;
}

export interface BarSeries {
  readonly key: string;
  readonly label: string;
  readonly color: string;
}

export interface BarDatum {
  readonly label: string;
  readonly values: Readonly<Record<string, number>>;
}

/** 堆叠柱状图；每根柱子带 title 提示具体数字 */
export function barChart(data: readonly BarDatum[], series: readonly BarSeries[]): string {
  const width = 900;
  const height = 180;
  const pad = { top: 10, bottom: 24, left: 32 };
  const totals = data.map((d) => series.reduce((n, s) => n + (d.values[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const slot = (width - pad.left) / Math.max(1, data.length);
  const barW = Math.max(2, slot * 0.7);
  const scale = (v: number) => (v / max) * (height - pad.top - pad.bottom);
  const bars = data
    .map((d, i) => {
      const x = pad.left + i * slot + (slot - barW) / 2;
      let y = height - pad.bottom;
      const tip = `${d.label}：${series.map((s) => `${s.label} ${d.values[s.key] ?? 0}`).join("，")}`;
      const rects = series
        .map((s) => {
          const h = scale(d.values[s.key] ?? 0);
          y -= h;
          return h > 0
            ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`
            : "";
        })
        .join("");
      // 首尾必显示；中间每 7 天一个，离最后一个太近的不显示，避免重叠
      const last = data.length - 1;
      const showLabel = i === 0 || i === last || (i % 7 === 0 && last - i >= 4);
      const label = showLabel
        ? `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(d.label.slice(5))}</text>`
        : "";
      return `<g><title>${esc(tip)}</title>${rects}<rect x="${x.toFixed(1)}" y="${pad.top}" width="${barW.toFixed(1)}" height="${height - pad.top - pad.bottom}" fill="transparent"/>${label}</g>`;
    })
    .join("");
  const axis = `<text x="0" y="${pad.top + 8}">${max}</text><text x="0" y="${height - pad.bottom}">0</text>`;
  const legend = series
    .map(
      (s) =>
        `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.label)}</span>`,
    )
    .join("");
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" role="img">${axis}${bars}</svg><div class="legend">${legend}</div></div>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1f2328;--muted:#6b7280;--border:#e5e7eb;--ok:#15803d;--ok-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--bad:#b91c1c;--bad-bg:#fee2e2;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--text:#e6edf3;--muted:#8b949e;--border:#30363d;--ok:#3fb950;--ok-bg:#12261a;--warn:#d29922;--warn-bg:#2d2208;--bad:#f85149;--bad-bg:#2d1214;--accent:#58a6ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:1;background:var(--card);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;flex-wrap:wrap;gap:8px 20px;align-items:baseline}
header h1{font-size:17px;margin:0}header .meta{color:var(--muted);font-size:13px}nav{display:flex;flex-wrap:wrap;gap:12px;margin-left:auto}nav a{color:var(--accent);text-decoration:none;font-size:13px}
main{max-width:1200px;margin:0 auto;padding:20px 24px 60px}section{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px 20px;margin-bottom:18px}
h2{font-size:16px;margin:0 0 12px}h3{font-size:14px;margin:18px 0 8px}.note,.empty{color:var(--muted);font-size:13px;margin:0 0 10px}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.stat{border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.stat-value{font-size:22px;font-weight:600;font-variant-numeric:tabular-nums}.stat-label{color:var(--muted);font-size:12px}.stat-hint{font-size:12px;color:var(--warn)}
.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
th{color:var(--muted);font-weight:500;white-space:nowrap}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}code{font-size:12px}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:12px;white-space:nowrap}.badge.ok{color:var(--ok);background:var(--ok-bg)}.badge.warn{color:var(--warn);background:var(--warn-bg)}.badge.bad{color:var(--bad);background:var(--bad-bg)}.badge.muted{color:var(--muted);border:1px solid var(--border)}
.chart svg{width:100%;height:auto}.chart text{fill:var(--muted);font-size:11px}.legend{display:flex;gap:14px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}details summary{cursor:pointer;color:var(--accent);font-size:13px;margin:6px 0}
`;

const NAV = [
  ["overview", "概览"],
  ["traffic", "访问数据"],
  ["sources", "抓取状态"],
  ["warnings", "告警和隔离区"],
  ["trend", "变动趋势"],
  ["quality", "数据质量"],
] as const;

export function page(title: string, meta: string, body: string): string {
  const nav = NAV.map(([id, label]) => `<a href="#${id}">${label}</a>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><header><h1>${esc(title)}</h1><span class="meta">${meta}</span><nav>${nav}</nav></header><main>${body}</main></body></html>`;
}
