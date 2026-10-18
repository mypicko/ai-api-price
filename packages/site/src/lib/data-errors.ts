/** 数据读取/校验失败时抛出，报错信息里带文件路径和具体字段，方便定位 */
export interface IssueLike {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export class DataLoadError extends Error {
  readonly file: string;

  constructor(file: string, message: string, options?: { cause?: unknown }) {
    super(`[site] 数据文件无效：${file}\n${message}`, options);
    this.name = "DataLoadError";
    this.file = file;
  }
}

const MAX_ISSUES = 10;

export function formatIssues(issues: readonly IssueLike[]): string {
  const lines = issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(根节点)";
    return `  - ${path}: ${issue.message}`;
  });
  const extra = issues.length > MAX_ISSUES ? [`  …另有 ${issues.length - MAX_ISSUES} 处错误`] : [];
  return [...lines, ...extra].join("\n");
}
