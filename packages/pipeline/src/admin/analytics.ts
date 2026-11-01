/**
 * 本地后台的访问数据：Cloudflare Web Analytics 的 GraphQL 统计接口（rumPageloadEventsAdaptiveGroups）。
 * 需要在 .env 里填 CF_API_TOKEN（权限：Account Analytics 只读）、CF_ACCOUNT_ID、CF_SITE_TAG。
 * 令牌只在本机使用，不会出现在页面和错误信息里。
 */
import { z } from "zod";

export const CLOUDFLARE_GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const TOP_LIMIT = 10;
const TIMEOUT_MS = 20_000;

export interface AnalyticsConfig {
  readonly apiToken: string;
  readonly accountId: string;
  readonly siteTag: string;
}

export type AnalyticsEnvResult =
  | { readonly ok: true; readonly config: AnalyticsConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

export interface DailyTraffic {
  readonly date: string;
  readonly pageViews: number;
  readonly visits: number;
}

export interface RankItem {
  readonly label: string;
  readonly count: number;
}

export interface TrafficReport {
  readonly daily: readonly DailyTraffic[];
  readonly totals: { readonly pageViews: number; readonly visits: number };
  readonly topPaths: readonly RankItem[];
  readonly topReferers: readonly RankItem[];
  readonly topCountries: readonly RankItem[];
}

const ENV_KEYS = ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_SITE_TAG"] as const;

export function parseAnalyticsEnv(
  env: Readonly<Record<string, string | undefined>>,
): AnalyticsEnvResult {
  const value = (key: string) => env[key]?.trim() ?? "";
  const missing = ENV_KEYS.filter((key) => value(key) === "");
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      apiToken: value("CF_API_TOKEN"),
      accountId: value("CF_ACCOUNT_ID"),
      siteTag: value("CF_SITE_TAG"),
    },
  };
}

const QUERY = `query AdminTraffic($accountTag: string, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      daily: rumPageloadEventsAdaptiveGroups(limit: 100, filter: $filter, orderBy: [date_ASC]) {
        count
        sum { visits }
        dimensions { date }
      }
      paths: rumPageloadEventsAdaptiveGroups(limit: ${TOP_LIMIT}, filter: $filter, orderBy: [count_DESC]) {
        count
        dimensions { requestPath }
      }
      referers: rumPageloadEventsAdaptiveGroups(limit: ${TOP_LIMIT}, filter: $filter, orderBy: [count_DESC]) {
        count
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(limit: ${TOP_LIMIT}, filter: $filter, orderBy: [count_DESC]) {
        count
        dimensions { countryName }
      }
    }
  }
}`;

const GroupSchema = z.object({
  count: z.number(),
  sum: z.object({ visits: z.number() }).optional(),
  dimensions: z.record(z.string(), z.string().nullable()),
});
const ResponseSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(
          z.object({
            daily: z.array(GroupSchema),
            paths: z.array(GroupSchema),
            referers: z.array(GroupSchema),
            countries: z.array(GroupSchema),
          }),
        ),
      }),
    })
    .nullable(),
  errors: z
    .array(z.object({ message: z.string() }))
    .nullable()
    .optional(),
});
type Group = z.infer<typeof GroupSchema>;

function rank(groups: readonly Group[], key: string, emptyLabel: string): readonly RankItem[] {
  return groups.map((g) => ({ label: g.dimensions[key] || emptyLabel, count: g.count }));
}

export function parseCloudflareResponse(body: unknown): TrafficReport {
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Cloudflare 统计接口返回的格式和预期不一致");
  const { data, errors } = parsed.data;
  if (errors && errors.length > 0)
    throw new Error(`Cloudflare 统计接口报错：${errors.map((e) => e.message).join("；")}`);
  const account = data?.viewer.accounts[0];
  if (!account) throw new Error("Cloudflare 统计接口没有返回这个账号的数据，检查 CF_ACCOUNT_ID");
  const daily = account.daily.map((g) => ({
    date: g.dimensions.date ?? "",
    pageViews: g.count,
    visits: g.sum?.visits ?? 0,
  }));
  return {
    daily,
    totals: {
      pageViews: daily.reduce((n, d) => n + d.pageViews, 0),
      visits: daily.reduce((n, d) => n + d.visits, 0),
    },
    topPaths: rank(account.paths, "requestPath", "（未知）"),
    topReferers: rank(account.referers, "refererHost", "直接访问"),
    topCountries: rank(account.countries, "countryName", "（未知）"),
  };
}

export interface FetchAnalyticsOptions {
  readonly days: number;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
}

function rangeStart(now: Date, days: number): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().replace(".000Z", "Z");
}

export async function fetchCloudflareAnalytics(
  config: AnalyticsConfig,
  options: FetchAnalyticsOptions,
): Promise<TrafficReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const variables = {
    accountTag: config.accountId,
    filter: {
      AND: [
        {
          datetime_geq: rangeStart(options.now, options.days),
          datetime_leq: options.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
        },
        { siteTag: config.siteTag },
      ],
    },
  };
  let response: Response;
  try {
    response = await fetchImpl(CLOUDFLARE_GRAPHQL_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("连不上 Cloudflare 统计接口（网络错误或超时）");
  }
  if (!response.ok)
    throw new Error(`Cloudflare 统计接口返回 HTTP ${response.status}，检查 CF_API_TOKEN 的权限`);
  return parseCloudflareResponse(await response.json());
}
