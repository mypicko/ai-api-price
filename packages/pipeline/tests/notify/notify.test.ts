import type { ChangeEvent, SourceResult } from "@aipb/shared";
import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { createLogger, silentLogger } from "../../src/core/logger";
import {
  buildEmail,
  createEmailNotifier,
  createSmtpTransport,
  type MailMessage,
} from "../../src/notify/email";
import {
  buildFeishuCard,
  buildFeishuPayload,
  createFeishuNotifier,
  feishuSign,
} from "../../src/notify/feishu";
import {
  buildReportText,
  escapeHtml,
  MAX_ITEMS_PER_SECTION,
  shouldNotify,
} from "../../src/notify/format";
import { createNotifiers, sendReport } from "../../src/notify/index";
import { buildTelegramText, createTelegramNotifier } from "../../src/notify/telegram";
import type { DailyReport, Notifier } from "../../src/notify/types";
import { buildTestReport } from "../../src/tools/notify-test";
import { createFakeHttp, makeConfig, NOW, NOW_ISO } from "../helpers";

const HOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/abc-secret-token";

function event(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: "2026-10-18-official:deepseek/deepseek-chat-1",
    type: "price_down",
    offeringId: "official:deepseek/deepseek-chat",
    vendor: "deepseek",
    modelSlug: "deepseek/deepseek-chat",
    displayName: "DeepSeek V3",
    platform: "official",
    currency: "CNY",
    fields: [{ field: "output", old: 8, new: 4, pct: -0.5 }],
    confirmedFromQuarantine: false,
    detectedAt: NOW_ISO,
    ...overrides,
  };
}

const source = (
  id: string,
  status: SourceResult["status"],
  errorCode: string | null = null,
): SourceResult => ({
  id,
  kind: "api",
  status,
  offeringCount: 1,
  durationMs: 1,
  errorCode,
  errorMessage: null,
  lastSuccessAt: null,
  consecutiveFailures: status === "ok" ? 0 : 1,
});

function report(overrides: Partial<DailyReport> = {}): DailyReport {
  return {
    date: "2026-10-18",
    run: { id: "1", startedAt: NOW_ISO, finishedAt: NOW_ISO, durationMs: 1, result: "partial" },
    sources: [source("litellm", "ok"), source("volcengine", "failed", "E1002")],
    changes: [
      event(),
      event({
        type: "price_up",
        displayName: "<b>X</b>",
        fields: [{ field: "input", old: 1, new: 2, pct: 1 }],
      }),
      event({
        type: "new_model",
        fields: [],
        displayName: "Grok 5",
        platform: "openrouter",
        currency: "USD",
      }),
    ],
    quarantined: [
      {
        offeringId: "official:alibaba/qwen-max",
        fields: [{ field: "input", old: 20, new: 8, pct: -0.6 }],
        candidate: { input: 8, output: 1, cacheRead: null, cacheWrite: null },
        firstSeenAt: NOW_ISO,
        lastSeenAt: NOW_ISO,
        confirmations: 1,
      },
    ],
    errors: [
      { code: "E1002", sourceId: "volcengine", message: "超时" },
      { code: "E1005", sourceId: "zhipu", message: "连续失败" },
    ],
    siteUrl: "https://example.github.io/board",
    names: { "official:alibaba/qwen-max": "通义千问 Max" },
    ...overrides,
  };
}

describe("notify/format", () => {
  it("按 DEV §3.9 模板生成文字", () => {
    const text = buildReportText(report());
    expect(text.title).toBe("📊 AI API 价格日报 · 2026-10-18");
    expect(text.link).toBe("https://example.github.io/board/changes");
    expect(text.lines[0]).toBe("⚠️ 成功 1/2 个源  失败：volcengine（E1002）");
    expect(text.lines).toContain("🔻 降价 1：DeepSeek V3（官方） 输出 ¥8.00→¥4.00（-50%）");
    expect(text.lines.some((l) => l.startsWith("🔺 涨价 1：<b>X</b>"))).toBe(true);
    expect(text.lines).toContain("🆕 新模型 1：Grok 5（OpenRouter）");
    expect(text.lines.some((l) => l.startsWith("🚧 隔离待确认 1：通义千问 Max 输入 -60%"))).toBe(
      true,
    );
    // 源失败已经在第一行展示，告警里不重复
    expect(text.lines.find((l) => l.startsWith("❗"))).toBe("❗ 告警 1：E1005 zhipu 连续失败");
  });

  it("超过 5 条时折叠；无变动时说明", () => {
    const many = Array.from({ length: 7 }, (_, i) => event({ id: `e${i}`, displayName: `M${i}` }));
    const line = buildReportText(report({ changes: many })).lines.find((l) => l.startsWith("🔻"));
    expect(line).toContain(`等 7 条`);
    expect(line?.split("；")).toHaveLength(MAX_ITEMS_PER_SECTION);
    const quiet = buildReportText(
      report({ changes: [], quarantined: [], errors: [], sources: [source("a", "ok")] }),
    );
    expect(quiet.lines).toEqual(["✅ 成功 1/1 个源", "今日无价格变动"]);
  });

  it("shouldNotify：有变动 / 告警 / 隔离 / NOTIFY_ON_SUCCESS 才推送", () => {
    const quiet = report({
      changes: [event({ type: "context_change" })],
      quarantined: [],
      errors: [],
      sources: [source("a", "ok")],
    });
    expect(shouldNotify(quiet, false)).toBe(false);
    expect(shouldNotify(quiet, true)).toBe(true);
    expect(shouldNotify({ ...quiet, changes: [event()] }, false)).toBe(true);
    expect(shouldNotify({ ...quiet, errors: [{ code: "E2002", message: "x" }] }, false)).toBe(true);
    expect(shouldNotify({ ...quiet, errors: [{ code: "W3007", message: "x" }] }, false)).toBe(
      false,
    );
    expect(shouldNotify({ ...quiet, sources: [source("a", "failed", "E1001")] }, false)).toBe(true);
    expect(shouldNotify(report({ changes: [], errors: [], sources: [] }), false)).toBe(true);
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("notify/feishu", () => {
  it("签名：base64(HMAC-SHA256(key = timestamp + \\n + secret, msg = 空))", () => {
    // 参考值由飞书文档的 Python 示例算出
    expect(feishuSign("1760832252", "test-secret")).toBe(
      "QmKu4HuwA+kvasEZZAw/KP+q/HqEgSKlS8KBnIUGV4M=",
    );
  });

  it("开启签名时 payload 带 timestamp（秒）和 sign；未开启时不带", () => {
    const now = new Date(1760832252_000);
    const signed = buildFeishuPayload(report(), "test-secret", now);
    expect(signed).toMatchObject({
      timestamp: "1760832252",
      sign: "QmKu4HuwA+kvasEZZAw/KP+q/HqEgSKlS8KBnIUGV4M=",
      msg_type: "interactive",
    });
    const plain = buildFeishuPayload(report(), null, now);
    expect(plain).not.toHaveProperty("sign");
    expect(plain).not.toHaveProperty("timestamp");
  });

  it("interactive 卡片：标题、颜色、正文（转义）、跳转按钮", () => {
    const card = buildFeishuCard(report()) as {
      header: { title: { content: string }; template: string };
      elements: [{ text: { tag: string; content: string } }, { actions: [{ url: string }] }];
    };
    expect(card.header.title.content).toBe("📊 AI API 价格日报 · 2026-10-18");
    expect(card.header.template).toBe("orange");
    expect(card.elements[0].text.tag).toBe("lark_md");
    expect(card.elements[0].text.content).toContain("🔻 降价 1：DeepSeek V3");
    expect(card.elements[0].text.content).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(card.elements[1].actions[0].url).toBe("https://example.github.io/board/changes");
    const ok = report({ run: { ...report().run, result: "success" }, errors: [], quarantined: [] });
    expect((buildFeishuCard(ok) as { header: { template: string } }).header.template).toBe("blue");
    const failed = report({ run: { ...report().run, result: "failed" } });
    expect((buildFeishuCard(failed) as { header: { template: string } }).header.template).toBe(
      "red",
    );
  });

  it('返回 {"code":0} 才算成功', async () => {
    const http = createFakeHttp({}, () => ({
      status: 200,
      text: '{"code":0,"msg":"success","data":{}}',
    }));
    const notifier = createFeishuNotifier({
      config: { webhookUrl: HOOK, secret: "s" },
      http,
      now: () => NOW,
    });
    await expect(notifier.send(report())).resolves.toBeUndefined();
    expect(http.requests[0]).toMatchObject({ method: "POST", url: HOOK });
    expect(notifier.isConfigured(makeConfig({ feishu: { webhookUrl: HOOK, secret: null } }))).toBe(
      true,
    );
    expect(notifier.isConfigured(makeConfig())).toBe(false);
  });

  it("code ≠ 0、非 JSON、HTTP 失败都抛 E5001，且错误信息不含 Webhook", async () => {
    const cases = [
      () => ({ status: 200, text: '{"code":19021,"msg":"sign match fail"}' }),
      () => ({ status: 200, text: "not json" }),
      () => ({ status: 200, text: "null" }),
      () => ({ status: 500, text: '{"code":0}' }),
    ];
    for (const respond of cases) {
      const notifier = createFeishuNotifier({
        config: { webhookUrl: HOOK, secret: null },
        http: createFakeHttp({}, respond),
        now: () => NOW,
      });
      const error = await notifier.send(report()).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "E5001" });
      expect(String(error)).not.toContain("abc-secret-token");
    }
    const throwing = createFakeHttp({}, () => {
      throw new PipelineError("E1003", `被拦截：${HOOK}`);
    });
    const notifier = createFeishuNotifier({
      config: { webhookUrl: HOOK, secret: null },
      http: throwing,
      now: () => NOW,
    });
    const error = await notifier.send(report()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "E5001" });
    expect((error as Error).message).not.toContain("abc-secret-token");
  });
});

describe("notify/telegram", () => {
  const config = { botToken: "123456:SECRET_TOKEN_abcdefghijklmn", chatId: "42" };

  it("sendMessage（HTML），ok:true 才算成功", async () => {
    const http = createFakeHttp({}, () => ({ status: 200, text: '{"ok":true}' }));
    await createTelegramNotifier({ config, http }).send(report());
    expect(http.requests[0]?.url).toBe(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    );
    expect(http.requests[0]?.body).toMatchObject({ chat_id: "42", parse_mode: "HTML" });
    expect(buildTelegramText(report())).toContain("<b>📊 AI API 价格日报 · 2026-10-18</b>");
    expect(buildTelegramText(report())).toContain("&lt;b&gt;X&lt;/b&gt;");
  });

  it("失败抛 E5001，不带 Token", async () => {
    for (const respond of [
      () => ({ status: 400, text: '{"ok":false}' }),
      () => ({ status: 200, text: "x" }),
    ]) {
      const error = await createTelegramNotifier({ config, http: createFakeHttp({}, respond) })
        .send(report())
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "E5001" });
      expect(String(error)).not.toContain("SECRET_TOKEN");
    }
    const error = await createTelegramNotifier({ config, http: createFakeHttp({}) })
      .send(report())
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "E5001" });
    expect((error as Error).message).not.toContain("SECRET_TOKEN");
  });
});

describe("notify/email", () => {
  const config = {
    host: "smtp.qq.com",
    port: 465,
    user: "bot@example.com",
    pass: "p",
    to: "me@example.com",
  };

  it("生成 HTML 邮件并发送", async () => {
    const sent: MailMessage[] = [];
    const notifier = createEmailNotifier({
      config,
      transport: { sendMail: async (m) => sent.push(m) },
    });
    await notifier.send(report());
    expect(sent[0]).toMatchObject({
      from: "bot@example.com",
      to: "me@example.com",
      subject: "📊 AI API 价格日报 · 2026-10-18",
    });
    expect(sent[0]?.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(buildEmail(report(), config).text).toContain(
      "🔗 https://example.github.io/board/changes",
    );
  });

  it("SMTP transport 按端口决定是否 TLS（创建时不连接）", () => {
    expect(typeof createSmtpTransport(config).sendMail).toBe("function");
    expect(createEmailNotifier({ config }).isConfigured(makeConfig({ email: config }))).toBe(true);
  });

  it("发送失败抛 E5001", async () => {
    const notifier = createEmailNotifier({
      config,
      transport: { sendMail: async () => Promise.reject(new Error("auth")) },
    });
    await expect(notifier.send(report())).rejects.toMatchObject({ code: "E5001" });
  });
});

describe("notify/index", () => {
  it("按配置创建渠道，飞书排第一", () => {
    const config = makeConfig({
      feishu: { webhookUrl: HOOK, secret: null },
      telegram: { botToken: "t", chatId: "1" },
      email: { host: "h", port: 465, user: "u", pass: "p", to: "t@example.com" },
    });
    expect(
      createNotifiers(config, { http: createFakeHttp({}), now: () => NOW }).map((n) => n.id),
    ).toEqual(["feishu", "telegram", "email"]);
    expect(createNotifiers(makeConfig(), { http: createFakeHttp({}), now: () => NOW })).toEqual([]);
  });

  it("推送失败只记 E5001，不影响其他渠道", async () => {
    const ok: Notifier = { id: "telegram", isConfigured: () => true, send: async () => undefined };
    const bad: Notifier = {
      id: "feishu",
      isConfigured: () => true,
      send: async () => Promise.reject(new PipelineError("E5001", "飞书推送失败")),
    };
    const lines: string[] = [];
    const result = await sendReport(
      [bad, ok],
      report(),
      createLogger({ write: (l) => lines.push(l) }),
    );
    expect(result.sent).toEqual(["telegram"]);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "E5001", message: "feishu：[E5001] 飞书推送失败" }),
    ]);
    expect(lines.some((l) => l.includes('"code":"E5001"'))).toBe(true);
  });

  it("notify:test 的测试消息", async () => {
    const test = buildTestReport(NOW, "https://x.io");
    expect(test.changes).toHaveLength(1);
    expect(buildReportText(test).lines.some((l) => l.includes("测试"))).toBe(true);
    const sent: string[] = [];
    const n: Notifier = {
      id: "feishu",
      isConfigured: () => true,
      send: async (r) => void sent.push(r.date),
    };
    await sendReport([n], test, silentLogger);
    expect(sent).toEqual(["2026-10-18"]);
  });
});
