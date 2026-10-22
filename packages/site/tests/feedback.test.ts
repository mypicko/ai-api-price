import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPO,
  correctionUrl,
  issuesUrl,
  repoFromEnv,
  submitUrl,
} from "../src/lib/feedback";

describe("feedback：纠错与提交报价链接", () => {
  it("仓库优先取 GITHUB_REPOSITORY，格式不对时用默认值", () => {
    expect(repoFromEnv({ GITHUB_REPOSITORY: "alice/prices" })).toBe("alice/prices");
    expect(repoFromEnv({})).toBe(DEFAULT_REPO);
    expect(repoFromEnv({ GITHUB_REPOSITORY: "bad value" })).toBe(DEFAULT_REPO);
  });

  it("纠错链接预填表单字段和标题", () => {
    const url = new URL(
      correctionUrl("alice/prices", {
        item: "DeepSeek-V3",
        platform: "官方",
        current: "输入 ¥2.00 / 输出 ¥8.00 每百万 tokens",
        evidence: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing",
        page: "https://alice.github.io/prices/models/deepseek/deepseek-chat/",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/alice/prices/issues/new");
    expect(url.searchParams.get("template")).toBe("price-correction.yml");
    expect(url.searchParams.get("title")).toBe("[纠错] DeepSeek-V3 · 官方");
    expect(url.searchParams.get("item")).toBe("DeepSeek-V3");
    expect(url.searchParams.get("current")).toContain("¥8.00");
    expect(url.searchParams.get("evidence")).toContain("deepseek.com");
    expect(url.searchParams.get("page")).toContain("/models/deepseek/deepseek-chat/");
  });

  it("没有平台时标题只写模型；空字段不写进链接", () => {
    const url = new URL(correctionUrl("alice/prices", { item: "Claude Max 5x" }));
    expect(url.searchParams.get("title")).toBe("[纠错] Claude Max 5x");
    expect(url.searchParams.has("platform")).toBe(false);
  });

  it("提交报价和问题列表链接", () => {
    expect(submitUrl("alice/prices")).toBe(
      "https://github.com/alice/prices/issues/new?template=submit-price.yml",
    );
    expect(issuesUrl("alice/prices")).toBe("https://github.com/alice/prices/issues");
  });
});
