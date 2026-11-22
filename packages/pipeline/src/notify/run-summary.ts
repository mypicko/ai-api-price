/**
 * 每日任务汇总（DEV_DOCUMENT §3.30）：daily 的最后一个任务 summary 调用 `pnpm pipeline notify:summary`，
 * 把各任务结果、国内站健康检查、公众号草稿标题、百度推送结果汇总成一条飞书消息。
 * - 有任务失败或国内站不正常 → 红色告警
 * - 公众号草稿存好了 → 蓝色提醒，带标题，提示去「公众号助手」群发（个人订阅号没有群发接口，只能手动）
 * - 全部正常又没有草稿 → 不发，免得每天刷屏（价格变动另有 run 的日报推送）
 */
import { shanghaiDate } from "../steps/dates";

export const JOB_LABELS = {
  update: "抓取价格 / 构建",
  deploy: "海外镜像部署",
  "deploy-cn": "国内站发布",
  wechat: "公众号草稿",
  "baidu-push": "百度推送",
} as const;

export type JobName = keyof typeof JOB_LABELS;
export type JobResult = "success" | "failure" | "cancelled" | "skipped";

export interface SiteHealth {
  readonly ok: boolean;
  readonly detail: string;
}

export interface SummaryInput {
  readonly date: string;
  readonly jobs: Readonly<Record<JobName, JobResult>>;
  readonly draftTitle: string | null;
  /** 周一的周报草稿标题 */
  readonly weeklyTitle?: string | null;
  readonly baidu: string | null;
  /** 没配置国内站时为 null（不检查） */
  readonly health: SiteHealth | null;
  readonly runUrl: string;
}

export interface RunSummary {
  readonly shouldSend: boolean;
  readonly level: "ok" | "error";
  readonly title: string;
  readonly lines: readonly string[];
}

const ENV_KEYS: Readonly<Record<JobName, string>> = {
  update: "JOB_UPDATE",
  deploy: "JOB_DEPLOY",
  "deploy-cn": "JOB_DEPLOY_CN",
  wechat: "JOB_WECHAT",
  "baidu-push": "JOB_BAIDU_PUSH",
};

const RESULTS: ReadonlySet<string> = new Set(["success", "failure", "cancelled", "skipped"]);
const JOB_NAMES = Object.keys(JOB_LABELS) as JobName[];

const optional = (value: string | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};

/** 读 GitHub 传进来的 needs.<job>.result；空值（任务不存在或没运行）按 skipped 处理 */
export function parseSummaryEnv(
  env: Readonly<Record<string, string | undefined>>,
): Pick<SummaryInput, "jobs" | "draftTitle" | "weeklyTitle" | "baidu"> {
  const jobs = Object.fromEntries(
    JOB_NAMES.map((name) => {
      const value = env[ENV_KEYS[name]]?.trim() ?? "";
      return [name, RESULTS.has(value) ? value : "skipped"];
    }),
  ) as Record<JobName, JobResult>;
  return {
    jobs,
    draftTitle: optional(env["WECHAT_DRAFT_TITLE"]),
    weeklyTitle: optional(env["WECHAT_WEEKLY_TITLE"]),
    baidu: optional(env["BAIDU_PUSH_RESULT"]),
  };
}

const RESULT_TEXT: Readonly<Record<JobResult, string>> = {
  success: "✅ 成功",
  failure: "❌ 失败",
  cancelled: "⚠️ 已取消",
  skipped: "— 跳过",
};

/** 草稿提醒：日报、周报各一行；订阅号每天只能群发一次，周一两篇都有时提示选一篇 */
function draftLines(input: SummaryInput): readonly string[] {
  const titles = [
    ...(input.draftTitle ? [`📝 日报草稿：**${input.draftTitle}**`] : []),
    ...(input.weeklyTitle ? [`📰 周报草稿：**${input.weeklyTitle}**`] : []),
  ];
  if (titles.length === 0) return [];
  const hint =
    titles.length > 1
      ? "打开手机「公众号助手」→ 草稿箱，选一篇群发（订阅号每天只能群发一次，建议周一发周报）"
      : "打开手机「公众号助手」→ 草稿箱 → 群发";
  return [...titles, hint, ""];
}

export function buildRunSummary(input: SummaryInput): RunSummary {
  const failed = JOB_NAMES.filter(
    (n) => input.jobs[n] === "failure" || input.jobs[n] === "cancelled",
  );
  const unhealthy = input.health !== null && !input.health.ok;
  const level = failed.length > 0 || unhealthy ? "error" : "ok";
  const lines = [
    ...draftLines(input),
    ...JOB_NAMES.map((n) => {
      const extra = n === "baidu-push" && input.baidu ? `（${input.baidu}）` : "";
      return `${JOB_LABELS[n]}：${RESULT_TEXT[input.jobs[n]]}${extra}`;
    }),
    ...(input.health
      ? [`国内站检查：${input.health.ok ? "✅" : "❌"} ${input.health.detail}`]
      : []),
    ...(level === "error" ? ["", `运行详情：${input.runUrl}`] : []),
  ];
  const title =
    level === "error"
      ? `❌ ${input.date} 每日任务失败：${[...failed.map((n) => JOB_LABELS[n]), ...(unhealthy ? ["国内站检查"] : [])].join("、")}`
      : `📝 ${input.date} 公众号草稿待群发`;
  const hasDraft = input.draftTitle !== null || (input.weeklyTitle ?? null) !== null;
  return { shouldSend: level === "error" || hasDraft, level, title, lines };
}

export function buildSummaryCard(summary: RunSummary, runUrl: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: summary.title },
      template: summary.level === "error" ? "red" : "blue",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: summary.lines.join("\n") } },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "查看运行" },
            url: runUrl,
            type: summary.level === "error" ? "danger" : "default",
          },
        ],
      },
    ],
  };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const STATUS_PATH = "/api/v1/status.json";

/** 国内站能打开、status.json 里最近一次运行的完成时间（换算成北京时间）是今天才算正常；从不抛错 */
export async function checkSiteHealth(
  site: string,
  today: string,
  fetchImpl: FetchLike = fetch,
): Promise<SiteHealth> {
  const url = `${site.replace(/\/+$/, "")}${STATUS_PATH}`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return { ok: false, detail: `国内站打不开（HTTP ${response.status}）` };
    const body = (await response.json()) as { data?: { run?: { finishedAt?: string } } };
    const finishedAt = body.data?.run?.finishedAt;
    const time = finishedAt ? Date.parse(finishedAt) : Number.NaN;
    if (Number.isNaN(time)) return { ok: false, detail: "status.json 里找不到运行时间" };
    const date = shanghaiDate(new Date(time));
    return { ok: date === today, detail: `数据日期 ${date}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `国内站打不开（${reason}）` };
  }
}
