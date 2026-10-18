import { describe, expect, it } from "vitest";
import { joinSiteUrl, loadConfig } from "../src/config";

describe("config", () => {
  it("空环境变量时使用默认值", () => {
    const { config, warnings } = loadConfig({});
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({
      siteUrl: "http://localhost:4321",
      basePath: "/",
      notifyOnSuccess: false,
      anomalyThreshold: 0.8,
      staleAlertDays: 3,
      staleWarnDays: 7,
      fxFallbackRate: 7.1,
      sourcesEnabled: null,
      dryRun: false,
      logLevel: "info",
      feishu: null,
      telegram: null,
      email: null,
      runId: null,
    });
  });

  it("空字符串视为未填写（.env.example 的写法）", () => {
    const { config } = loadConfig({
      FEISHU_WEBHOOK_URL: "",
      NOTIFY_ON_SUCCESS: " ",
      SOURCES_ENABLED: "",
    });
    expect(config.feishu).toBeNull();
    expect(config.sourcesEnabled).toBeNull();
  });

  it("解析数值、布尔、列表与站点地址", () => {
    const { config } = loadConfig({
      SITE_URL: "https://alice.github.io/",
      BASE_PATH: "/ai-api-price/",
      NOTIFY_ON_SUCCESS: "true",
      ANOMALY_THRESHOLD: "0.5",
      STALE_ALERT_DAYS: "2",
      FX_FALLBACK_RATE: "7.2",
      SOURCES_ENABLED: "litellm, openrouter",
      DRY_RUN: "1",
      LOG_LEVEL: "debug",
      GITHUB_RUN_ID: "999",
      GITHUB_STEP_SUMMARY: "/tmp/summary.md",
    });
    expect(config).toMatchObject({
      siteUrl: "https://alice.github.io/ai-api-price",
      notifyOnSuccess: true,
      anomalyThreshold: 0.5,
      staleAlertDays: 2,
      fxFallbackRate: 7.2,
      sourcesEnabled: ["litellm", "openrouter"],
      dryRun: true,
      logLevel: "debug",
      runId: "999",
      stepSummaryPath: "/tmp/summary.md",
    });
  });

  it("格式错误抛 E0001，且不在错误信息里带出取值", () => {
    expect(() => loadConfig({ ANOMALY_THRESHOLD: "abc" })).toThrow(/E0001/);
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
    expect(() => loadConfig({ NOTIFY_CHANNELS: "feishu,wechat" })).toThrow(/E0001/);
    try {
      loadConfig({ FEISHU_WEBHOOK_URL: "http://open.feishu.cn/open-apis/bot/v2/hook/supersecret" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("E0001");
      expect(String(error)).not.toContain("supersecret");
    }
  });

  it("飞书：有 URL 即启用，Secret 可选", () => {
    const { config } = loadConfig({
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/x",
      FEISHU_WEBHOOK_SECRET: "s",
    });
    expect(config.feishu).toEqual({
      webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/x",
      secret: "s",
    });
    expect(
      loadConfig({ FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/x" }).config
        .feishu?.secret,
    ).toBeNull();
  });

  it("飞书只填了 Secret：W0002 并禁用", () => {
    const { config, warnings } = loadConfig({ FEISHU_WEBHOOK_SECRET: "s" });
    expect(config.feishu).toBeNull();
    expect(warnings).toEqual([
      expect.objectContaining({ code: "W0002", message: expect.stringContaining("feishu") }),
    ]);
  });

  it("Telegram / 邮件配置不完整：W0002 并禁用", () => {
    const { config, warnings } = loadConfig({ TELEGRAM_BOT_TOKEN: "t", SMTP_HOST: "smtp.qq.com" });
    expect(config.telegram).toBeNull();
    expect(config.email).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(["W0002", "W0002"]);
  });

  it("Telegram / 邮件配置完整时启用", () => {
    const { config } = loadConfig({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_CHAT_ID: "1",
      SMTP_HOST: "smtp.qq.com",
      SMTP_PORT: "587",
      SMTP_USER: "bot@example.com",
      SMTP_PASS: "p",
      NOTIFY_EMAIL_TO: "me@example.com",
    });
    expect(config.telegram).toEqual({ botToken: "t", chatId: "1" });
    expect(config.email).toEqual({
      host: "smtp.qq.com",
      port: 587,
      user: "bot@example.com",
      pass: "p",
      to: "me@example.com",
    });
  });

  it("NOTIFY_CHANNELS 只启用列出的渠道；列出但没配置时 W0002", () => {
    const { config, warnings } = loadConfig({
      NOTIFY_CHANNELS: "telegram",
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/x",
    });
    expect(config.feishu).toBeNull();
    expect(warnings).toEqual([
      expect.objectContaining({ code: "W0002", message: expect.stringContaining("telegram") }),
    ]);
  });

  it("joinSiteUrl 去掉多余斜杠", () => {
    expect(joinSiteUrl("https://a.io/", "/")).toBe("https://a.io");
    expect(joinSiteUrl("https://a.io", "/repo/")).toBe("https://a.io/repo");
  });
});
