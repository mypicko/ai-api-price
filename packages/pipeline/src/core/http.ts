/**
 * 统一 HTTP 客户端（DEV_DOCUMENT §3.2 礼貌抓取约定、§9 E1001~E1003）。
 * - 超时：AbortSignal.timeout
 * - 重试：网络错误 / 5xx / 408，指数退避 1s → 3s → 9s
 * - 反爬：401/403/429 或挑战页 → E1003，不重试
 * - 限速：同一主机请求间隔 ≥ minIntervalMs（可按主机用 hostIntervalMs 覆盖），串行
 * - 跳转：只跟随同主机跳转
 */
import { PipelineError } from "./errors";

export interface HttpRequestOptions {
  readonly timeoutMs?: number;
  readonly headers?: Record<string, string>;
}

export interface HttpClient {
  getText(url: string, options?: HttpRequestOptions): Promise<string>;
  getJson<T = unknown>(url: string, options?: HttpRequestOptions): Promise<T>;
  post(
    url: string,
    body: unknown,
    options?: HttpRequestOptions,
  ): Promise<{ status: number; text: string }>;
}

export interface HttpClientOptions {
  readonly userAgent: string;
  readonly minIntervalMs?: number;
  /** 按主机覆盖请求间隔，例如公开 API 可以比网页抓取更快：{ "openrouter.ai": 200 } */
  readonly hostIntervalMs?: Readonly<Record<string, number>>;
  readonly retries?: number;
  readonly backoffMs?: readonly number[];
  readonly defaultTimeoutMs?: number;
  readonly maxRedirects?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const CHALLENGE_MARKERS = [
  "cf-challenge",
  "challenge-platform",
  "Just a moment...",
  "captcha",
  "验证码",
  "滑动验证",
];

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 挑战页通常很短；大页面里偶然出现 "captcha" 字样不算 */
export function looksLikeChallenge(body: string): boolean {
  return body.length < 50_000 && CHALLENGE_MARKERS.some((marker) => body.includes(marker));
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const minIntervalMs = options.minIntervalMs ?? 1000;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? [1000, 3000, 9000];
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
  const maxRedirects = options.maxRedirects ?? 5;

  /** 每个主机一条 Promise 链，保证串行 + 间隔 */
  const hostQueues = new Map<string, Promise<unknown>>();
  const hostLastAt = new Map<string, number>();

  function schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = hostQueues.get(host) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const last = hostLastAt.get(host);
        if (last !== undefined) {
          const interval = options.hostIntervalMs?.[host] ?? minIntervalMs;
          const wait = last + interval - now();
          if (wait > 0) await sleep(wait);
        }
        try {
          return await task();
        } finally {
          hostLastAt.set(host, now());
        }
      });
    hostQueues.set(host, run);
    return run;
  }

  async function fetchFollowingSameHost(url: string, init: RequestInit): Promise<Response> {
    let current = new URL(url);
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const response = await fetchImpl(current, { ...init, redirect: "manual" });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      const next = new URL(location, current);
      if (next.host !== current.host) {
        throw new PipelineError("E1001", `拒绝跨域跳转：${current.host} → ${next.host}`);
      }
      current = next;
    }
    throw new PipelineError("E1001", `跳转次数超过 ${maxRedirects}：${url}`);
  }

  async function attempt(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    requestOptions: HttpRequestOptions,
  ): Promise<{ status: number; text: string }> {
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
    const headers: Record<string, string> = {
      "user-agent": options.userAgent,
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...requestOptions.headers,
    };
    let response: Response;
    try {
      response = await fetchFollowingSameHost(url, {
        method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof PipelineError) throw error;
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new PipelineError("E1002", `请求超时（${timeoutMs}ms）：${url}`, {
          cause: error,
          retryable: true,
        });
      }
      throw new PipelineError("E1001", `网络错误：${url}`, { cause: error, retryable: true });
    }

    const text = await response.text();
    if (
      [401, 403, 429].includes(response.status) ||
      (response.status >= 200 && response.status < 300 && looksLikeChallenge(text))
    ) {
      throw new PipelineError("E1003", `疑似被拦截（HTTP ${response.status}）：${url}`);
    }
    if (method === "GET" && (response.status < 200 || response.status >= 300)) {
      const retryable = response.status >= 500 || response.status === 408;
      throw new PipelineError("E1001", `HTTP ${response.status}：${url}`, { retryable });
    }
    return { status: response.status, text };
  }

  async function withRetry(
    method: "GET" | "POST",
    url: string,
    body: unknown,
    requestOptions: HttpRequestOptions = {},
  ): Promise<{ status: number; text: string }> {
    const host = new URL(url).host;
    let lastError: unknown;
    for (let i = 0; i <= retries; i += 1) {
      try {
        return await schedule(host, () => attempt(method, url, body, requestOptions));
      } catch (error) {
        lastError = error;
        const retryable = error instanceof PipelineError && error.retryable;
        if (!retryable || i === retries) break;
        await sleep(backoff[Math.min(i, backoff.length - 1)] ?? 1000);
      }
    }
    throw lastError;
  }

  return {
    async getText(url, requestOptions) {
      return (await withRetry("GET", url, undefined, requestOptions)).text;
    },
    async getJson<T>(url: string, requestOptions?: HttpRequestOptions): Promise<T> {
      const text = (await withRetry("GET", url, undefined, requestOptions)).text;
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        throw new PipelineError("E2001", `响应不是合法 JSON：${url}`, { cause: error });
      }
    },
    async post(url, body, requestOptions) {
      return withRetry("POST", url, body, requestOptions);
    },
  };
}
