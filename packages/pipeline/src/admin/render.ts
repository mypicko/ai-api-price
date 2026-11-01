/**
 * 本地后台页面：概览、访问数据、抓取状态、告警和隔离区、变动趋势、数据质量。
 */
import { formatPct } from "@aipb/shared";
import type { Dashboard, NamedWarning } from "./dashboard";
import { badge, barChart, esc, page, section, stat, table, type Tone } from "./html";
import type { RankItem } from "./analytics";

/** 详细列表最多显示的行数，其余折叠 */
export const MAX_DETAIL_ROWS = 50;

const RESULT_TONE: Readonly<Record<string, Tone>> = {
  success: "ok",
  partial: "warn",
  failed: "bad",
};
const RESULT_LABEL: Readonly<Record<string, string>> = {
  success: "成功",
  partial: "部分失败",
  failed: "失败",
};
const SOURCE_LABEL: Readonly<Record<string, [string, Tone]>> = {
  ok: ["正常", "ok"],
  failed: ["失败", "bad"],
  rejected: ["被拒绝", "warn"],
};

/** ISO 时间 → 北京时间「2026-10-31 20:01」 */
export function beijingTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} 秒`;
const num = (value: number): string => `<span class="num">${value.toLocaleString("zh-CN")}</span>`;

function limited<T>(items: readonly T[], render: (shown: readonly T[]) => string): string {
  if (items.length <= MAX_DETAIL_ROWS) return render(items);
  return `${render(items.slice(0, MAX_DETAIL_ROWS))}<p class="note">只显示前 ${MAX_DETAIL_ROWS} 条，共 ${items.length} 条</p>`;
}

function overview(d: Dashboard): string {
  const failed = d.sources.filter((s) => s.status !== "ok").length;
  const runLabel = d.run ? (RESULT_LABEL[d.run.result] ?? d.run.result) : "—";
  const stats = [
    stat("模型", d.summary.models),
    stat("在售报价", d.summary.offerings),
    stat("平台", d.summary.platforms),
    stat("厂商", d.summary.vendors),
    stat("已下架报价", d.summary.removed),
    stat(
      "数据源",
      `${d.sources.length - failed}/${d.sources.length}`,
      failed > 0 ? `${failed} 个失败` : "",
    ),
    stat("告警", d.warnings.length),
    stat("隔离区", d.quarantine.length),
  ].join("");
  const run = d.run
    ? `最近一次运行：${esc(beijingTime(d.run.finishedAt))}（北京时间） ${badge(runLabel, RESULT_TONE[d.run.result] ?? "muted")} 耗时 ${esc(seconds(d.run.durationMs))}`
    : "还没有运行记录";
  const fx = d.usdCny === null ? "" : ` · 汇率 1 USD = ${esc(d.usdCny)} CNY（${esc(d.fxDate)}）`;
  return section(
    "overview",
    "概览",
    `<p class="note">${run}${fx}</p><div class="stats">${stats}</div>`,
  );
}

function rankTable(title: string, items: readonly RankItem[]): string {
  return `<div><h3>${esc(title)}</h3>${table(
    ["", "浏览量"],
    items.map((i) => [esc(i.label), num(i.count)]),
  )}</div>`;
}

function traffic(d: Dashboard): string {
  const t = d.traffic;
  if (t.kind === "unconfigured") {
    const body = `<p class="note">还没有配置 Cloudflare 统计接口。在项目根目录的 <code>.env</code> 里填写：${t.missing.map((k) => `<code>${esc(k)}</code>`).join("、")}，然后刷新页面。获取方法见 DEV_DOCUMENT §8.7。</p>`;
    return section("traffic", "访问数据", body);
  }
  if (t.kind === "error")
    return section("traffic", "访问数据", `<p>${badge("获取失败", "bad")} ${esc(t.message)}</p>`);
  const r = t.report;
  const stats = [
    stat(`近 ${t.days} 天浏览量`, r.totals.pageViews),
    stat(`近 ${t.days} 天访问次数`, r.totals.visits),
    stat("日均浏览量", Math.round(r.totals.pageViews / Math.max(1, r.daily.length))),
  ].join("");
  const chart = barChart(
    r.daily.map((day) => ({ label: day.date, values: { pageViews: day.pageViews } })),
    [{ key: "pageViews", label: "浏览量", color: "#2563eb" }],
  );
  const ranks = `<div class="grid2">${rankTable("热门页面", r.topPaths)}${rankTable("访问来源", r.topReferers)}${rankTable("国家/地区", r.topCountries)}</div>`;
  return section(
    "traffic",
    "访问数据",
    `<div class="stats">${stats}</div>${chart}${ranks}`,
    "数据来自 Cloudflare Web Analytics，结果缓存 10 分钟；地址后加 ?refresh=1 强制刷新。",
  );
}

function sources(d: Dashboard): string {
  const rows = d.sources.map((s) => {
    const [label, tone] = SOURCE_LABEL[s.status] ?? [s.status, "muted"];
    const failures =
      s.consecutiveFailures > 0
        ? badge(`连续 ${s.consecutiveFailures} 次`, s.consecutiveFailures >= 3 ? "bad" : "warn")
        : "";
    const error = s.errorCode ? `<code>${esc(s.errorCode)}</code> ${esc(s.errorMessage)}` : "";
    return [
      `<code>${esc(s.id)}</code>`,
      esc(s.kind),
      `${badge(label, tone)} ${failures}`,
      num(s.offeringCount),
      esc(seconds(s.durationMs)),
      esc(beijingTime(s.lastSuccessAt)),
      error,
    ];
  });
  return section(
    "sources",
    "抓取状态",
    table(["数据源", "类型", "状态", "报价数", "耗时", "上次成功", "错误"], rows),
    "失败的数据源排在最前面；连续失败 3 次以上标红。",
  );
}

function warningRows(items: readonly NamedWarning[]): readonly (readonly string[])[] {
  return items.map((w) => [
    `<code>${esc(w.code)}</code>`,
    esc(w.name ?? w.offeringId ?? w.sourceId),
    esc(w.message),
  ]);
}

function warnings(d: Dashboard): string {
  const groups = table(
    ["代码", "含义", "条数"],
    d.warningGroups.map((g) => [`<code>${esc(g.code)}</code>`, esc(g.label), num(g.count)]),
  );
  const details =
    d.warnings.length === 0
      ? ""
      : `<details><summary>查看全部 ${d.warnings.length} 条告警</summary>${limited(d.warnings, (shown) => table(["代码", "模型 / 数据源", "说明"], warningRows(shown)))}</details>`;
  const quarantine = table(
    ["报价", "变动字段", "首次发现", "最近一次"],
    d.quarantine.map((q) => [
      esc(q.name ?? q.offeringId),
      esc(q.fields.map((f) => `${f.field} ${formatPct(f.pct)}`).join("，")),
      esc(beijingTime(q.firstSeenAt)),
      esc(beijingTime(q.lastSeenAt)),
    ]),
  );
  return section(
    "warnings",
    "告警和隔离区",
    `${groups}${details}<h3>隔离区（价格突变，暂扣待确认）</h3>${quarantine}`,
    "来自最近一次运行的 status.json。",
  );
}

function trend(d: Dashboard): string {
  const total = (key: "price_down" | "price_up" | "new_model" | "removed") =>
    d.trend.reduce((n, t) => n + t[key], 0);
  const stats = [
    stat("降价", total("price_down")),
    stat("涨价", total("price_up")),
    stat("新模型", total("new_model")),
    stat("下架", total("removed")),
  ].join("");
  const chart = barChart(
    d.trend.map((t) => ({
      label: t.date,
      values: {
        price_down: t.price_down,
        price_up: t.price_up,
        new_model: t.new_model,
        removed: t.removed,
      },
    })),
    [
      { key: "price_down", label: "降价", color: "#16a34a" },
      { key: "price_up", label: "涨价", color: "#dc2626" },
      { key: "new_model", label: "新模型", color: "#2563eb" },
      { key: "removed", label: "下架", color: "#9ca3af" },
    ],
  );
  return section(
    "trend",
    `变动趋势（近 ${d.trend.length} 天）`,
    `<div class="stats">${stats}</div>${chart}`,
    "鼠标停在柱子上可以看当天的具体数字。",
  );
}

function quality(d: Dashboard): string {
  const q = d.quality;
  const outliers = limited(q.outliers, (shown) =>
    table(
      ["模型", "说明"],
      shown.map((w) => [esc(w.name ?? w.offeringId), esc(w.message)]),
    ),
  );
  const stale = limited(q.stale, (shown) =>
    table(
      ["报价", "平台", "状态", "连续缺失"],
      shown.map((o) => [
        esc(o.displayName),
        esc(d.platformName(o.platform)),
        esc(o.status),
        `${num(o.missingDays)} 天`,
      ]),
    ),
  );
  const dups = limited(q.duplicates, (shown) =>
    table(
      ["厂商", "疑似同一模型的不同 ID"],
      shown.map((g) => [
        esc(d.vendorName(g.vendor)),
        g.slugs.map((s) => `<code>${esc(s)}</code>`).join("<br>"),
      ]),
    ),
  );
  const byVendor = new Map<string, number>();
  for (const o of q.rawNames) byVendor.set(o.vendor, (byVendor.get(o.vendor) ?? 0) + 1);
  const rawSummary = table(
    ["厂商", "条数"],
    [...byVendor].toSorted((a, b) => b[1] - a[1]).map(([v, n]) => [esc(d.vendorName(v)), num(n)]),
  );
  const rawList =
    q.rawNames.length === 0
      ? ""
      : `<details><summary>查看明细</summary>${limited(q.rawNames, (shown) =>
          table(
            ["展示名", "平台"],
            shown.map((o) => [
              `<code>${esc(o.displayName)}</code>`,
              esc(d.platformName(o.platform)),
            ]),
          ),
        )}</details>`;
  const body = [
    `<h3>OpenRouter 异常低价（${q.outliers.length}）</h3><p class="note">比同模型其它平台中位数低 3 倍以上、且低于所有平台的 OpenRouter 价（V9），网站价差榜已跳过。</p>${outliers}`,
    `<h3>过期报价（${q.stale.length}）</h3><p class="note">连续几天没抓到、网站上沿用旧值的报价。</p>${stale}`,
    `<h3>疑似重复的模型（${q.duplicates.length}）</h3><p class="note">同一厂商下写法相近的模型 ID（如 2p5 / 2.5、带不带 -instruct），需要人工确认是不是同一个模型，是的话加到 config/aliases.yaml。</p>${dups}`,
    `<h3>展示名是原始 ID（${q.rawNames.length}）</h3><p class="note">数据源没给好看的名字，网站上直接显示 ID（如 gpt-6-rosalind）。</p>${rawSummary}${rawList}`,
  ].join("");
  return section("quality", "数据质量", body);
}

export function renderDashboard(d: Dashboard): string {
  const meta = `数据日期 ${esc(d.dataDate)} · 生成于 ${esc(beijingTime(d.generatedAt))}（北京时间） · 只在本机运行，只读`;
  return page(
    "AI API 价格榜 · 本地后台",
    meta,
    [overview(d), traffic(d), sources(d), warnings(d), trend(d), quality(d)].join(""),
  );
}
