/**
 * 本地后台的数据组装：读 data/ 和配置，算出页面要展示的全部内容（不含 HTML）。
 */
import path from "node:path";
import {
  FxFileSchema,
  LatestFileSchema,
  StatusFileSchema,
  type ChangeEvent,
  type FxFile,
  type LatestFile,
  type Offering,
  type ProvidersConfig,
  type QuarantineEntry,
  type SourceResult,
  type StatusFile,
  type Warning,
} from "@aipb/shared";
import { loadProviders } from "../config-files";
import { ERROR_CODES } from "../core/errors";
import { outlierCheck } from "../steps/cross-check";
import { monthOf, shanghaiDate } from "../steps/dates";
import { loadChangesMonth, readJsonFile } from "../steps/state";
import type { TrafficReport } from "./analytics";
import {
  changeTrend,
  duplicateGroups,
  rawNameOfferings,
  staleOfferings,
  summarize,
  type DuplicateGroup,
  type Summary,
  type TrendDay,
} from "./insights";

export const TREND_DAYS = 30;

export interface AdminData {
  readonly today: string;
  readonly latest: LatestFile | null;
  readonly status: StatusFile | null;
  readonly fx: FxFile | null;
  readonly events: readonly ChangeEvent[];
  readonly providers: ProvidersConfig;
}

export type TrafficState =
  | { readonly kind: "ok"; readonly report: TrafficReport; readonly days: number }
  | { readonly kind: "unconfigured"; readonly missing: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

export interface WarningGroup {
  readonly code: string;
  readonly label: string;
  readonly count: number;
}

export interface NamedWarning extends Warning {
  /** offeringId 对应的模型名（找得到时） */
  readonly name: string | null;
}

export interface Dashboard {
  readonly today: string;
  readonly dataDate: string | null;
  readonly generatedAt: string | null;
  readonly run: StatusFile["run"] | null;
  readonly usdCny: number | null;
  readonly fxDate: string | null;
  readonly summary: Summary;
  readonly sources: readonly SourceResult[];
  readonly warningGroups: readonly WarningGroup[];
  readonly warnings: readonly NamedWarning[];
  readonly quarantine: readonly (QuarantineEntry & { readonly name: string | null })[];
  readonly trend: readonly TrendDay[];
  readonly quality: {
    readonly outliers: readonly NamedWarning[];
    readonly stale: readonly Offering[];
    readonly duplicates: readonly DuplicateGroup[];
    readonly rawNames: readonly Offering[];
  };
  readonly traffic: TrafficState;
  readonly vendorName: (id: string) => string;
  readonly platformName: (id: string) => string;
}

/** 读本月和上个月的变动（趋势要覆盖最近 30 天） */
async function loadRecentEvents(dataDir: string, today: string): Promise<readonly ChangeEvent[]> {
  const first = new Date(`${today}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - TREND_DAYS);
  const months = [...new Set([monthOf(first.toISOString().slice(0, 10)), monthOf(today)])];
  const files = await Promise.all(months.map((m) => loadChangesMonth(dataDir, m)));
  return files.flatMap((f) => f?.events ?? []);
}

export async function loadAdminData(
  rootDir: string,
  dataDir: string,
  now: Date,
): Promise<AdminData> {
  const today = shanghaiDate(now);
  const [latest, status, fx, events, providers] = await Promise.all([
    readJsonFile(path.join(dataDir, "latest.json"), LatestFileSchema),
    readJsonFile(path.join(dataDir, "status.json"), StatusFileSchema),
    readJsonFile(path.join(dataDir, "fx.json"), FxFileSchema),
    loadRecentEvents(dataDir, today),
    loadProviders(rootDir),
  ]);
  return { today, latest, status, fx, events, providers };
}

/** 失败的源排前面，其次按连续失败次数、ID */
function sortSources(sources: readonly SourceResult[]): readonly SourceResult[] {
  const rank = (s: SourceResult) => (s.status === "ok" ? 1 : 0);
  return sources.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      b.consecutiveFailures - a.consecutiveFailures ||
      a.id.localeCompare(b.id),
  );
}

function groupWarnings(warnings: readonly Warning[]): readonly WarningGroup[] {
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
  return [...counts]
    .map(([code, count]) => ({
      code,
      label: (ERROR_CODES as Readonly<Record<string, string>>)[code] ?? "",
      count,
    }))
    .toSorted((a, b) => a.code.localeCompare(b.code));
}

export function buildDashboard(data: AdminData, traffic: TrafficState): Dashboard {
  const offerings = data.latest?.offerings ?? [];
  const byId = new Map(offerings.map((o) => [o.id, o.displayName]));
  const named = (w: Warning): NamedWarning => ({
    ...w,
    name: w.offeringId ? (byId.get(w.offeringId) ?? null) : null,
  });
  const vendors = new Map(data.providers.vendors.map((v) => [v.id, v.nameZh]));
  const platforms = new Map(data.providers.platforms.map((p) => [p.id, p.nameZh]));
  const warnings = data.status?.warnings ?? [];
  const usdCny = data.fx?.latest.usdCny ?? null;
  return {
    today: data.today,
    dataDate: data.latest?.dataDate ?? null,
    generatedAt: data.latest?.generatedAt ?? null,
    run: data.status?.run ?? null,
    usdCny,
    fxDate: data.fx?.latest.date ?? null,
    summary: summarize(offerings),
    sources: sortSources(data.status?.sources ?? []),
    warningGroups: groupWarnings(warnings),
    warnings: warnings.map(named),
    quarantine: (data.status?.quarantine ?? []).map((q) => ({
      ...q,
      name: byId.get(q.offeringId) ?? null,
    })),
    trend: changeTrend(data.events, data.today, TREND_DAYS),
    quality: {
      outliers: usdCny === null ? [] : outlierCheck(offerings, usdCny).map(named),
      stale: staleOfferings(offerings),
      duplicates: duplicateGroups(offerings),
      rawNames: rawNameOfferings(offerings),
    },
    traffic,
    vendorName: (id) => vendors.get(id) ?? id,
    platformName: (id) => platforms.get(id) ?? id,
  };
}
