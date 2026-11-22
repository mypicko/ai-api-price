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

  it.each(["wechat", "deploy-cn"])(
    "%s 任务不依赖 github.com（腾讯云服务器连不上）：不用任何 action，从 api.github.com 下载代码",
    (name) => {
      const steps = (load("daily.yml").jobs[name]?.["steps"] ?? []) as readonly {
        readonly uses?: string;
        readonly run?: string;
      }[];
      expect(steps.length).toBeGreaterThan(0);
      const uses = steps.flatMap((s) => (s.uses ? [s.uses.split("@")[0]] : []));
      expect(uses).toEqual([]);
      const script = steps.map((s) => s.run ?? "").join("\n");
      expect(script).toContain("https://api.github.com/repos/");
      expect(script).not.toMatch(/https:\/\/github\.com/);
    },
  );

  it("daily 有国内站部署任务：腾讯云运行器、在 update 之后、设置了 CN_SITE_URL 才运行、只读权限", () => {
    const job = load("daily.yml").jobs["deploy-cn"];
    expect(job?.["runs-on"]).toEqual(["self-hosted", "tencent"]);
    expect(job?.["needs"]).toBe("update");
    expect(job?.if).toContain("vars.CN_SITE_URL != ''");
    expect(job?.["permissions"]).toEqual({ contents: "read" });
    // 不碰任何密钥：只构建静态网站
    expect(JSON.stringify(job)).not.toContain("secrets.");
  });

  it("公众号「阅读原文」优先用国内站地址", () => {
    const steps = (load("daily.yml").jobs["wechat"]?.["steps"] ?? []) as readonly {
      readonly env?: Readonly<Record<string, string>>;
    }[];
    const env = steps.find((s) => s.env?.["WECHAT_APPID"])?.env;
    expect(env?.["SITE_URL"]).toContain("vars.CN_SITE_URL");
  });

  it("海外镜像（GitHub Pages）构建时 canonical 指向国内主站", () => {
    const steps = (load("daily.yml").jobs["update"]?.["steps"] ?? []) as readonly {
      readonly run?: string;
      readonly env?: Readonly<Record<string, string>>;
    }[];
    const build = steps.find((s) => s.run === "pnpm build");
    expect(build?.env?.["CANONICAL_URL"]).toBe("${{ vars.CN_SITE_URL }}");
  });

  it("国内站构建不设置 CANONICAL_URL（自己就是主站）", () => {
    expect(JSON.stringify(load("daily.yml").jobs["deploy-cn"])).not.toContain("CANONICAL_URL");
  });

  it("百度推送在国内站发布之后、跑在 GitHub 托管运行器上，令牌只出现在这个任务里", () => {
    const jobs = load("daily.yml").jobs;
    const job = jobs["baidu-push"];
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    expect(job?.["needs"]).toBe("deploy-cn");
    expect(job?.["permissions"]).toEqual({ contents: "read" });
    expect(JSON.stringify(job)).toContain("secrets.BAIDU_PUSH_TOKEN");
    expect(JSON.stringify(job)).toContain("pnpm pipeline baidu:push");
    for (const [name, other] of Object.entries(jobs))
      if (name !== "baidu-push")
        expect(JSON.stringify(other), name).not.toContain("BAIDU_PUSH_TOKEN");
  });

  it("最后有汇总任务：等所有任务结束（失败也运行），读各任务结果，草稿标题经环境变量传入", () => {
    const wf = load("daily.yml");
    const job = wf.jobs["summary"];
    expect(job?.["needs"]).toEqual(["update", "deploy", "deploy-cn", "wechat", "baidu-push"]);
    expect(job?.if).toContain("always()");
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    expect(job?.["permissions"]).toEqual({ contents: "read" });
    const steps = (job?.["steps"] ?? []) as readonly {
      readonly run?: string;
      readonly env?: Readonly<Record<string, string>>;
    }[];
    const step = steps.find((s) => s.run === "pnpm pipeline notify:summary");
    expect(step?.env?.["WECHAT_DRAFT_TITLE"]).toBe("${{ needs.wechat.outputs.draft_title }}");
    expect(step?.env?.["JOB_DEPLOY_CN"]).toContain("result");
    // 不能把任务输出直接拼进脚本
    for (const s of steps) expect(s.run ?? "").not.toContain("${{");
    expect(wf.jobs["wechat"]?.["outputs"]).toEqual({
      draft_title: "${{ steps.draft.outputs.draft_title }}",
      weekly_title: "${{ steps.weekly.outputs.weekly_title }}",
    });
    expect(step?.env?.["WECHAT_WEEKLY_TITLE"]).toBe("${{ needs.wechat.outputs.weekly_title }}");
    const wechatRuns = ((wf.jobs["wechat"]?.["steps"] ?? []) as readonly { run?: string }[]).map(
      (s) => s.run,
    );
    expect(wechatRuns).toContain("pnpm pipeline wechat:weekly --monday-only");
  });
});
