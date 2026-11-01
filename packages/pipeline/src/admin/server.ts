/**
 * 本地后台服务（`pnpm admin`）：只监听 127.0.0.1，每次请求重新读 data/，只读不写。
 * 访问数据缓存 10 分钟，地址加 ?refresh=1 强制刷新。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchCloudflareAnalytics, parseAnalyticsEnv } from "./analytics";
import { buildDashboard, loadAdminData, type TrafficState } from "./dashboard";
import { esc } from "./html";
import { renderDashboard } from "./render";

export const DEFAULT_ADMIN_PORT = 4400;
export const TRAFFIC_DAYS = 30;
const TRAFFIC_CACHE_MS = 10 * 60 * 1000;

export interface AdminServerOptions {
  readonly rootDir: string;
  readonly dataDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

export type AdminHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createAdminHandler(opts: AdminServerOptions): AdminHandler {
  const now = opts.now ?? (() => new Date());
  let cache: { readonly at: number; readonly state: TrafficState } | null = null;

  async function traffic(refresh: boolean): Promise<TrafficState> {
    const env = parseAnalyticsEnv(opts.env);
    if (!env.ok) return { kind: "unconfigured", missing: env.missing };
    const at = now().getTime();
    if (!refresh && cache && at - cache.at < TRAFFIC_CACHE_MS) return cache.state;
    let state: TrafficState;
    try {
      const report = await fetchCloudflareAnalytics(env.config, {
        days: TRAFFIC_DAYS,
        now: now(),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      state = { kind: "ok", report, days: TRAFFIC_DAYS };
    } catch (error) {
      state = { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    cache = { at, state };
    return state;
  }

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET" || url.pathname !== "/") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("找不到页面");
      return;
    }
    try {
      const [data, trafficState] = await Promise.all([
        loadAdminData(opts.rootDir, opts.dataDir, now()),
        traffic(url.searchParams.has("refresh")),
      ]);
      const html = renderDashboard(buildDashboard(data, trafficState));
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(html);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res
        .writeHead(500, { "content-type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><meta charset="utf-8"><h1>读取数据失败</h1><pre>${esc(message)}</pre>`,
        );
    }
  };
}

export interface RunningAdminServer {
  readonly url: string;
  close(): Promise<void>;
}

/** port 传 0 时由系统分配（测试用） */
export async function startAdminServer(
  opts: AdminServerOptions,
  port: number,
): Promise<RunningAdminServer> {
  const handler = createAdminHandler(opts);
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${actual}/`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
