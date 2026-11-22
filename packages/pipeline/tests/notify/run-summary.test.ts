import { describe, expect, it, vi } from "vitest";
import {
  buildRunSummary,
  buildSummaryCard,
  checkSiteHealth,
  parseSummaryEnv,
} from "../../src/notify/run-summary";

const OK_JOBS = {
  update: "success",
  deploy: "success",
  "deploy-cn": "success",
  wechat: "success",
  "baidu-push": "success",
} as const;
const BASE = {
  date: "2026-11-22",
  jobs: OK_JOBS,
  draftTitle: null,
  baidu: null,
  health: { ok: true, detail: "数据日期 2026-11-22" },
  runUrl: "https://github.com/o/r/actions/runs/1",
};

describe("每日任务汇总（失败告警 + 公众号草稿提醒，DEV §3.30）", () => {
  it("全部成功且没有草稿时不发消息，免得每天刷屏", () => {
    expect(buildRunSummary(BASE).shouldSend).toBe(false);
  });

  it("草稿存好时发提醒：带标题，提示去公众号助手群发", () => {
    const s = buildRunSummary({ ...BASE, draftTitle: "DeepSeek 降价 50%", baidu: "成功 10 条" });
    expect(s).toMatchObject({ shouldSend: true, level: "ok" });
    expect(s.title).toContain("草稿");
    expect(s.lines.join("\n")).toContain("日报草稿");
    expect(s.lines.join("\n")).toContain("DeepSeek 降价 50%");
    expect(s.lines.join("\n")).toContain("公众号助手");
    expect(s.lines.join("\n")).toContain("成功 10 条");
  });

  it("周一有周报草稿时一起提醒，提示每天只能群发一次", () => {
    const s = buildRunSummary({ ...BASE, draftTitle: "日报", weeklyTitle: "周报标题" });
    expect(s.shouldSend).toBe(true);
    expect(s.lines.join("\n")).toContain("周报标题");
    expect(s.lines.join("\n")).toContain("每天只能群发一次");
    expect(buildRunSummary({ ...BASE, weeklyTitle: "周报" }).shouldSend).toBe(true);
  });

  it("任何任务失败都告警（红色），列出失败的任务和运行链接", () => {
    const s = buildRunSummary({ ...BASE, jobs: { ...OK_JOBS, "deploy-cn": "failure" } });
    expect(s).toMatchObject({ shouldSend: true, level: "error" });
    expect(s.title).toContain("失败");
    expect(s.lines.join("\n")).toContain("国内站发布");
    expect(s.lines.join("\n")).toContain(BASE.runUrl);
  });

  it("没开启而跳过的任务（skipped）不算失败", () => {
    const s = buildRunSummary({ ...BASE, jobs: { ...OK_JOBS, wechat: "skipped" } });
    expect(s.shouldSend).toBe(false);
  });

  it("国内站打不开或数据不是今天的也告警", () => {
    const s = buildRunSummary({ ...BASE, health: { ok: false, detail: "数据日期 2026-11-21" } });
    expect(s).toMatchObject({ shouldSend: true, level: "error" });
    expect(s.lines.join("\n")).toContain("数据日期 2026-11-21");
  });

  it("飞书卡片：失败红色、正常蓝色，带查看运行按钮", () => {
    const card = buildSummaryCard(
      buildRunSummary({ ...BASE, jobs: { ...OK_JOBS, update: "failure" } }),
      BASE.runUrl,
    );
    expect(JSON.stringify(card)).toContain('"template":"red"');
    expect(JSON.stringify(card)).toContain(BASE.runUrl);
    const ok = buildSummaryCard(buildRunSummary({ ...BASE, draftTitle: "x" }), BASE.runUrl);
    expect(JSON.stringify(ok)).toContain('"template":"blue"');
  });

  it("从环境变量读各任务结果（GitHub 的 needs.<job>.result）", () => {
    const input = parseSummaryEnv({
      JOB_UPDATE: "success",
      JOB_DEPLOY: "failure",
      JOB_DEPLOY_CN: "skipped",
      JOB_WECHAT: "cancelled",
      JOB_BAIDU_PUSH: "",
      WECHAT_DRAFT_TITLE: " 标题 ",
      WECHAT_WEEKLY_TITLE: "周报",
      BAIDU_PUSH_RESULT: "成功 3 条",
    });
    expect(input.jobs).toEqual({
      update: "success",
      deploy: "failure",
      "deploy-cn": "skipped",
      wechat: "cancelled",
      "baidu-push": "skipped",
    });
    expect(input.draftTitle).toBe("标题");
    expect(input.weeklyTitle).toBe("周报");
    expect(input.baidu).toBe("成功 3 条");
  });
});

describe("国内站健康检查", () => {
  it("status.json 的运行时间换算成北京时间后是今天才算正常", async () => {
    // UTC 11-21 23:45 = 北京时间 11-22 07:45
    const body = { success: true, data: { run: { finishedAt: "2026-11-21T23:45:27Z" } } };
    const fetchImpl = vi.fn<(url: string) => Promise<Response>>(async () => Response.json(body));
    expect(await checkSiteHealth("https://promptso.top/", "2026-11-22", fetchImpl)).toEqual({
      ok: true,
      detail: "数据日期 2026-11-22",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://promptso.top/api/v1/status.json");
    expect((await checkSiteHealth("https://promptso.top", "2026-11-23", fetchImpl)).ok).toBe(false);
    const broken = vi.fn(async () => Response.json({ data: {} }));
    expect((await checkSiteHealth("https://promptso.top", "2026-11-22", broken)).ok).toBe(false);
  });

  it("打不开时返回失败原因，不抛错", async () => {
    const down = vi.fn(async () => new Response("", { status: 502 }));
    expect(await checkSiteHealth("https://promptso.top", "2026-11-22", down)).toEqual({
      ok: false,
      detail: "国内站打不开（HTTP 502）",
    });
    const err = vi.fn(async () => {
      throw new Error("timeout");
    });
    expect((await checkSiteHealth("https://promptso.top", "2026-11-22", err)).ok).toBe(false);
  });
});
