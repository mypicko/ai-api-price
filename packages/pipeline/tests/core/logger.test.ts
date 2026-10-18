import { describe, expect, it } from "vitest";
import { isPipelineError, PipelineError, toPipelineError } from "../../src/core/errors";
import { createLogger, redact } from "../../src/core/logger";

describe("core/logger", () => {
  it("脱敏飞书 Webhook、Telegram Token", () => {
    expect(redact("https://open.feishu.cn/open-apis/bot/v2/hook/abc-123")).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/***",
    );
    expect(redact("https://api.telegram.org/bot123456:ABCdefGHIjklMNOpqrSTUvwx/sendMessage")).toBe(
      "https://api.telegram.org/bot***/sendMessage",
    );
    expect(redact("token 1234567:abcdefghijklmnopqrstuvwxyz")).toBe("token 1234567:***");
  });

  it("输出结构化 JSON 行，并按级别过滤", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      write: (l) => lines.push(l),
      now: () => new Date("2026-10-18T00:00:00Z"),
    });
    logger.debug("不输出");
    logger.info("你好", { sourceId: "x" });
    logger.child({ run: 1 }).error("出错", { error: new Error("boom") });
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      level: "info",
      ts: "2026-10-18T00:00:00.000Z",
      msg: "你好",
      sourceId: "x",
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({
      level: "error",
      run: 1,
      error: { name: "Error", message: "boom" },
    });
  });

  it("日志内容会被脱敏", () => {
    const lines: string[] = [];
    createLogger({ write: (l) => lines.push(l) }).warn("失败", {
      url: "https://open.feishu.cn/open-apis/bot/v2/hook/secret",
    });
    expect(lines[0]).not.toContain("secret");
  });
});

describe("core/errors", () => {
  it("toPipelineError 保留已有错误码，未知错误归为兜底码", () => {
    const original = new PipelineError("E1003", "x");
    expect(toPipelineError(original, "E2001")).toBe(original);
    const wrapped = toPipelineError(new Error("boom"), "E2001", "src");
    expect(wrapped).toMatchObject({ code: "E2001", sourceId: "src" });
    expect(isPipelineError(wrapped)).toBe(true);
    expect(toPipelineError("str", "E2001").message).toContain("str");
  });
});
