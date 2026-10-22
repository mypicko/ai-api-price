/**
 * 纠错与提交报价（DEV §3.16）：链接到 GitHub Issue 表单（.github/ISSUE_TEMPLATE），
 * 纠错链接通过 URL 参数预填表单字段（字段 id 与表单 YAML 一致）。不需要后端。
 * 浏览器端也会用到，不能引入 zod。
 */
export const DEFAULT_REPO = "mypicko/ai-api-price";

const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/** 构建时读取：GitHub Actions 自带 GITHUB_REPOSITORY，fork 后链接自动指向自己的仓库 */
export function repoFromEnv(env: Readonly<Record<string, string | undefined>>): string {
  const repo = env["GITHUB_REPOSITORY"]?.trim() ?? "";
  return REPO_PATTERN.test(repo) ? repo : DEFAULT_REPO;
}

export interface CorrectionFields {
  /** 模型或套餐名称 */
  readonly item: string;
  readonly platform?: string;
  /** 网站当前显示的价格（已格式化） */
  readonly current?: string;
  /** 官方页面链接 */
  readonly evidence?: string;
  /** 网站上的页面地址 */
  readonly page?: string;
}

function newIssueUrl(repo: string, params: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return `https://github.com/${repo}/issues/new?${query.toString()}`;
}

export function correctionUrl(repo: string, fields: CorrectionFields): string {
  const title = `[纠错] ${fields.item}${fields.platform ? ` · ${fields.platform}` : ""}`;
  return newIssueUrl(repo, {
    template: "price-correction.yml",
    title,
    item: fields.item,
    platform: fields.platform,
    current: fields.current,
    evidence: fields.evidence,
    page: fields.page,
  });
}

export function submitUrl(repo: string): string {
  return newIssueUrl(repo, { template: "submit-price.yml" });
}

export function issuesUrl(repo: string): string {
  return `https://github.com/${repo}/issues`;
}
