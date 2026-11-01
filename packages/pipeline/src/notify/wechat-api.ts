/**
 * 微信公众号接口（DEV_DOCUMENT §3.24）：只用到草稿箱相关的三个接口。
 * - access_token：POST /cgi-bin/stable_token（不会让别处正在用的 token 失效），有效期内复用，提前 5 分钟刷新
 * - 永久图片素材：POST /cgi-bin/material/add_material?type=image（封面用，multipart 字段 media）
 * - 新建草稿：POST /cgi-bin/draft/add
 * 返回 errcode 非 0 时抛 E5001；错误信息不带 AppSecret 和 access_token。
 * 调用方 IP 必须在公众号后台的 IP 白名单里，否则返回 40164。
 */
import { PipelineError } from "../core/errors";

export const WECHAT_API_BASE = "https://api.weixin.qq.com/cgi-bin";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 20_000;

/** 常见错误码 → 处理提示 */
const ERROR_HINTS: Readonly<Record<number, string>> = {
  40001: "access_token 无效，检查 AppSecret 是否正确",
  40013: "AppID 不正确",
  40125: "AppSecret 不正确",
  40164: "调用方 IP 不在公众号后台的 IP 白名单里",
  45009: "接口调用次数超过当日上限",
  48001: "公众号没有这个接口的权限（看「设置与开发 → 接口权限」）",
  53404: "账号已被限制发文",
  89503: "调用方 IP 需要管理员在公众号后台确认",
};

export interface DraftArticle {
  readonly title: string;
  readonly author: string | null;
  readonly digest: string;
  /** 正文 HTML */
  readonly content: string;
  /** 「阅读原文」链接 */
  readonly contentSourceUrl: string;
  /** 封面图的永久素材 media_id */
  readonly thumbMediaId: string;
}

export interface WechatApi {
  getAccessToken(): Promise<string>;
  /** 上传永久图片素材，返回 media_id */
  uploadImage(image: Uint8Array<ArrayBuffer>, filename: string): Promise<string>;
  /** 新建草稿，返回草稿的 media_id */
  addDraft(article: DraftArticle): Promise<string>;
}

export interface WechatApiOptions {
  readonly appId: string;
  readonly appSecret: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

function fail(step: string, detail: string): PipelineError {
  return new PipelineError("E5001", `公众号接口失败（${step}）：${detail}`);
}

/** 解析响应；errcode 非 0 时抛错，errmsg 里的 token 片段去掉 */
async function parse(step: string, response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw fail(step, `HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw fail(step, "响应不是合法 JSON");
  }
  if (typeof body !== "object" || body === null) throw fail(step, "响应不是对象");
  const record = body as Record<string, unknown>;
  const code = typeof record.errcode === "number" ? record.errcode : 0;
  if (code !== 0) {
    const raw = typeof record.errmsg === "string" ? record.errmsg : "";
    const msg = raw.replace(/access_token[^\s,]*/gi, "access_token=***");
    const hint = ERROR_HINTS[code];
    throw fail(step, `errcode=${code}${hint ? `，${hint}` : ""}（${msg}）`);
  }
  return record;
}

function stringField(step: string, record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") throw fail(step, `响应缺少 ${key}`);
  return value;
}

export function createWechatApi(options: WechatApiOptions): WechatApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { readonly token: string; readonly expiresAt: number } | null = null;

  async function request(step: string, url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      throw new PipelineError("E5001", `公众号接口失败（${step}）：网络错误`, { cause: error });
    }
    return parse(step, response);
  }

  async function getAccessToken(): Promise<string> {
    if (cached && now() < cached.expiresAt) return cached.token;
    const body = await request("获取 access_token", `${WECHAT_API_BASE}/stable_token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: options.appId,
        secret: options.appSecret,
      }),
    });
    const token = stringField("获取 access_token", body, "access_token");
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 7200;
    cached = { token, expiresAt: now() + expiresIn * 1000 - REFRESH_MARGIN_MS };
    return token;
  }

  return {
    getAccessToken,
    async uploadImage(image, filename) {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("media", new Blob([image], { type: "image/png" }), filename);
      const body = await request(
        "上传封面",
        `${WECHAT_API_BASE}/material/add_material?access_token=${token}&type=image`,
        { method: "POST", body: form },
      );
      return stringField("上传封面", body, "media_id");
    },
    async addDraft(article) {
      const token = await getAccessToken();
      const payload = {
        articles: [
          {
            title: article.title,
            ...(article.author ? { author: article.author } : {}),
            digest: article.digest,
            content: article.content,
            content_source_url: article.contentSourceUrl,
            thumb_media_id: article.thumbMediaId,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      };
      const body = await request("新建草稿", `${WECHAT_API_BASE}/draft/add?access_token=${token}`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      return stringField("新建草稿", body, "media_id");
    },
  };
}
