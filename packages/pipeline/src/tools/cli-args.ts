/**
 * `run` 命令的参数解析：只解析 argv，不引入 CLI 库。
 *   --dry-run  --no-notify  --only a,b  （也支持 --only=a,b）
 */
export interface RunFlags {
  readonly dryRun: boolean;
  readonly notify: boolean;
  readonly only: readonly string[] | null;
}

function splitList(value: string): readonly string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function parseRunFlags(args: readonly string[]): RunFlags {
  const initial: RunFlags & { readonly expectOnly: boolean } = {
    dryRun: false,
    notify: true,
    only: null,
    expectOnly: false,
  };
  const state = args.reduce((acc, arg) => {
    if (acc.expectOnly) {
      if (arg.startsWith("--"))
        throw new Error("--only 需要源 ID 列表，例如 --only litellm,openrouter");
      return { ...acc, only: splitList(arg), expectOnly: false };
    }
    if (arg === "--dry-run") return { ...acc, dryRun: true };
    if (arg === "--no-notify") return { ...acc, notify: false };
    if (arg === "--only") return { ...acc, expectOnly: true };
    if (arg.startsWith("--only=")) return { ...acc, only: splitList(arg.slice("--only=".length)) };
    throw new Error(`未知参数：${arg}`);
  }, initial);
  if (state.expectOnly) throw new Error("--only 需要源 ID 列表，例如 --only litellm,openrouter");
  return { dryRun: state.dryRun, notify: state.notify, only: state.only };
}
