import { describe, expect, it } from "vitest";
import { PipelineError } from "../../src/core/errors";
import { createHttpClient, looksLikeChallenge } from "../../src/core/http";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(handler: Handler, extra: { minIntervalMs?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  const client = createHttpClient({
    userAgent: "TestBot/1.0",
    fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...extra,
  });
  return { client, calls, sleeps, advance: (ms: number) => (clock += ms) };
}

describe("core/http", () => {
  it("成功时返回文本并带上 UA", async () => {
    const { client, calls } = setup(() => new Response("hello"));
    await expect(client.getText("https://a.example/x")).resolves.toBe("hello");
    expect((calls[0]?.init.headers as Record<string, string>)["user-agent"]).toBe("TestBot/1.0");
  });

  it("5xx 按 1s/3s/9s 指数退避重试 3 次后抛 E1001", async () => {
    const { client, calls, sleeps } = setup(() => new Response("oops", { status: 503 }), {
      minIntervalMs: 0,
    });
    const error = await client.getText("https://a.example/x").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("E1001");
    expect(calls).toHaveLength(4);
    expect(sleeps.filter((ms) => ms >= 1000)).toEqual([1000, 3000, 9000]);
  });

  it("重试后成功则返回结果", async () => {
    let n = 0;
    const { client } = setup(
      () => (++n < 2 ? new Response("", { status: 500 }) : new Response("ok")),
      { minIntervalMs: 0 },
    );
    await expect(client.getText("https://a.example/x")).resolves.toBe("ok");
    expect(n).toBe(2);
  });

  it("403/429 视为反爬拦截 E1003，不重试", async () => {
    for (const status of [403, 429]) {
      const { client, calls } = setup(() => new Response("no", { status }));
      await expect(client.getText("https://a.example/x")).rejects.toMatchObject({ code: "E1003" });
      expect(calls).toHaveLength(1);
    }
  });

  it("挑战页（Just a moment...）视为 E1003", async () => {
    const { client } = setup(() => new Response("<title>Just a moment...</title>"));
    await expect(client.getText("https://a.example/x")).rejects.toMatchObject({ code: "E1003" });
  });

  it("大页面里偶然出现 captcha 字样不算挑战页", () => {
    expect(looksLikeChallenge(`captcha ${"x".repeat(60_000)}`)).toBe(false);
    expect(looksLikeChallenge("请完成滑动验证")).toBe(true);
  });

  it("4xx（非拦截）不重试", async () => {
    const { client, calls } = setup(() => new Response("missing", { status: 404 }));
    await expect(client.getText("https://a.example/x")).rejects.toMatchObject({
      code: "E1001",
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("只跟随同主机跳转，拒绝跨域跳转", async () => {
    const same = setup((url) =>
      url.endsWith("/old")
        ? new Response(null, { status: 301, headers: { location: "/new" } })
        : new Response("moved"),
    );
    await expect(same.client.getText("https://a.example/old")).resolves.toBe("moved");
    expect(same.calls.map((c) => c.url)).toEqual([
      "https://a.example/old",
      "https://a.example/new",
    ]);

    const cross = setup(
      () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(cross.client.getText("https://a.example/old")).rejects.toThrow(/跨域跳转/);
  });

  it("跳转次数超过上限时报错", async () => {
    const { client } = setup(
      () => new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    await expect(client.getText("https://a.example/loop")).rejects.toThrow(/跳转次数/);
  });

  it("同一主机的请求间隔 ≥ minIntervalMs", async () => {
    const { client, sleeps } = setup(() => new Response("ok"), { minIntervalMs: 1000 });
    await Promise.all([
      client.getText("https://a.example/1"),
      client.getText("https://a.example/2"),
    ]);
    expect(sleeps).toEqual([1000]);
  });

  it("超时转成 E1002 并可重试", async () => {
    let n = 0;
    const { client } = setup(
      () => {
        n += 1;
        if (n === 1) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
        return new Response("ok");
      },
      { minIntervalMs: 0 },
    );
    await expect(client.getText("https://a.example/x")).resolves.toBe("ok");
  });

  it("网络错误转成 E1001", async () => {
    const { client } = setup(
      () => {
        throw new TypeError("fetch failed");
      },
      { minIntervalMs: 0 },
    );
    await expect(client.getText("https://a.example/x")).rejects.toMatchObject({ code: "E1001" });
  });

  it("getJson 解析失败抛 E2001", async () => {
    const { client } = setup(() => new Response("<html>"));
    await expect(client.getJson("https://a.example/x")).rejects.toMatchObject({ code: "E2001" });
    const ok = setup(() => new Response('{"a":1}'));
    await expect(ok.client.getJson("https://a.example/x")).resolves.toEqual({ a: 1 });
  });

  it("post 发送 JSON 并返回状态码（非 2xx 不抛错）", async () => {
    const { client, calls } = setup(() => new Response('{"code":9}', { status: 400 }));
    await expect(client.post("https://a.example/hook", { a: 1 })).resolves.toEqual({
      status: 400,
      text: '{"code":9}',
    });
    expect(calls[0]?.init.body).toBe('{"a":1}');
    expect(calls[0]?.init.method).toBe("POST");
  });
});
