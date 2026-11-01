import { describe, expect, it } from "vitest";
import { isPipelineError } from "../../src/core/errors";
import { createWechatApi, WECHAT_API_BASE } from "../../src/notify/wechat-api";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** 按路径（不含查询参数）返回预置 JSON，记录每次请求 */
function fakeFetch(routes: Readonly<Record<string, unknown>>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname.replace("/cgi-bin", "");
    if (!(path in routes)) throw new Error(`未 mock 的请求：${path}`);
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

const TOKEN = { access_token: "TOKEN-123", expires_in: 7200 };
const creds = { appId: "wx-app", appSecret: "very-secret" };

describe("公众号接口客户端", () => {
  it("用 stable_token 换 access_token，有效期内复用", async () => {
    const { impl, calls } = fakeFetch({ "/stable_token": TOKEN });
    const api = createWechatApi({ ...creds, fetchImpl: impl, now: () => 0 });
    expect(await api.getAccessToken()).toBe("TOKEN-123");
    expect(await api.getAccessToken()).toBe("TOKEN-123");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${WECHAT_API_BASE}/stable_token`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      grant_type: "client_credential",
      appid: "wx-app",
      secret: "very-secret",
    });
  });

  it("新建草稿：带上 access_token，正文中文不转义，返回 media_id", async () => {
    const { impl, calls } = fakeFetch({
      "/stable_token": TOKEN,
      "/draft/add": { media_id: "DRAFT-1" },
    });
    const api = createWechatApi({ ...creds, fetchImpl: impl });
    const id = await api.addDraft({
      title: "AI 价格日报",
      author: "AI序言",
      digest: "摘要",
      content: "<p>正文</p>",
      contentSourceUrl: "https://example.com/changes",
      thumbMediaId: "THUMB-1",
    });
    expect(id).toBe("DRAFT-1");
    const draft = calls[1];
    expect(draft?.url).toBe(`${WECHAT_API_BASE}/draft/add?access_token=TOKEN-123`);
    const body = String(draft?.init.body);
    expect(body).toContain("AI 价格日报");
    expect(JSON.parse(body)).toEqual({
      articles: [
        {
          title: "AI 价格日报",
          author: "AI序言",
          digest: "摘要",
          content: "<p>正文</p>",
          content_source_url: "https://example.com/changes",
          thumb_media_id: "THUMB-1",
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    });
  });

  it("上传永久图片素材：multipart 字段名为 media，返回 media_id", async () => {
    const { impl, calls } = fakeFetch({
      "/stable_token": TOKEN,
      "/material/add_material": { media_id: "IMG-1", url: "http://mmbiz.qpic.cn/x" },
    });
    const api = createWechatApi({ ...creds, fetchImpl: impl });
    const id = await api.uploadImage(new Uint8Array([137, 80, 78, 71]), "cover.png");
    expect(id).toBe("IMG-1");
    const upload = calls[1];
    expect(upload?.url).toBe(
      `${WECHAT_API_BASE}/material/add_material?access_token=TOKEN-123&type=image`,
    );
    const form = upload?.init.body;
    if (!(form instanceof FormData)) throw new Error("应为 FormData");
    const file = form.get("media");
    expect(file instanceof Blob && file.size).toBe(4);
  });

  it("errcode 非 0 时抛 E5001，带上中文提示，不泄露 AppSecret 和 access_token", async () => {
    const { impl } = fakeFetch({
      "/stable_token": TOKEN,
      "/draft/add": { errcode: 40164, errmsg: "invalid ip 1.2.3.4, not in whitelist" },
    });
    const api = createWechatApi({ ...creds, fetchImpl: impl });
    const error = await api
      .addDraft({
        title: "t",
        author: null,
        digest: "d",
        content: "c",
        contentSourceUrl: "https://example.com",
        thumbMediaId: "x",
      })
      .catch((e: unknown) => e);
    expect(isPipelineError(error) && error.code).toBe("E5001");
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("40164");
    expect(message).toContain("IP 白名单");
    expect(message).toContain("1.2.3.4");
    expect(message).not.toContain("very-secret");
    expect(message).not.toContain("TOKEN-123");
  });

  it("换 token 失败（AppSecret 错误）也抛 E5001", async () => {
    const { impl } = fakeFetch({
      "/stable_token": { errcode: 40125, errmsg: "invalid appsecret" },
    });
    const api = createWechatApi({ ...creds, fetchImpl: impl });
    await expect(api.getAccessToken()).rejects.toThrow(/AppSecret/);
  });
});
