/**
 * 工作流安全守卫（DEV_DOCUMENT §8.9）：仓库是公开的，自托管运行器（腾讯云）只能被定时 / 手动触发的任务使用，
 * 公众号密钥只能交给自托管运行器上的任务。
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOW_DIR = path.resolve(import.meta.dirname, "../../../.github/workflows");
const SAFE_TRIGGERS = new Set(["schedule", "workflow_dispatch"]);

interface Job {
  readonly "runs-on"?: string | readonly string[];
  readonly if?: string;
  readonly [key: string]: unknown;
}
interface Workflow {
  readonly on: string | readonly string[] | Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

function load(file: string): Workflow {
  return parse(readFileSync(path.join(WORKFLOW_DIR, file), "utf8")) as Workflow;
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((file) => ({ file, wf: load(file) }));

function triggers(wf: Workflow): readonly string[] {
  if (typeof wf.on === "string") return [wf.on];
  return Array.isArray(wf.on) ? wf.on : Object.keys(wf.on);
}

const isSelfHosted = (job: Job): boolean => {
  const runsOn = job["runs-on"];
  return (Array.isArray(runsOn) ? runsOn : [runsOn]).includes("self-hosted");
};

describe("工作流安全守卫", () => {
  it("用自托管运行器的工作流只能由定时或手动触发（不能是 push / pull_request 等）", () => {
    for (const { file, wf } of workflows) {
      if (!Object.values(wf.jobs).some(isSelfHosted)) continue;
      expect(
        triggers(wf).filter((t) => !SAFE_TRIGGERS.has(t)),
        file,
      ).toEqual([]);
    }
  });

  it("公众号密钥只出现在自托管运行器上的任务里", () => {
    for (const { file, wf } of workflows) {
      for (const [name, job] of Object.entries(wf.jobs)) {
        if (JSON.stringify(job).includes("secrets.WECHAT_"))
          expect(isSelfHosted(job), `${file} → ${name}`).toBe(true);
      }
    }
  });

  it("daily 有公众号任务：跑在腾讯云自托管运行器上，在 update 之后，需要 WECHAT_ENABLED 打开", () => {
    const job = load("daily.yml").jobs["wechat"];
    expect(job?.["runs-on"]).toEqual(["self-hosted", "tencent"]);
    expect(job?.["needs"]).toBe("update");
    expect(job?.if).toContain("vars.WECHAT_ENABLED == 'true'");
    expect(job?.["permissions"]).toEqual({ contents: "read" });
  });
});
