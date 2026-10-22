/**
 * 浏览器端取价格榜全量数据（DEV §3.19）。浏览器端运行，不能引入 zod，只做结构检查。
 */
import type { BoardData } from "./board-data";

function isBoardData(value: unknown): value is BoardData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const packed = v["packedRows"] as Record<string, unknown> | undefined;
  return (
    typeof packed === "object" &&
    packed !== null &&
    typeof packed["count"] === "number" &&
    Array.isArray(packed["columns"]) &&
    Array.isArray(v["mediaRows"]) &&
    Array.isArray(v["media"]) &&
    Array.isArray(v["planRows"])
  );
}

export async function fetchBoardData(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<BoardData> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`价格榜数据加载失败：HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isBoardData(body)) throw new Error("价格榜数据格式不正确");
  return body;
}

/** 浏览器空闲时执行；不支持 requestIdleCallback 的浏览器（Safari）退回 setTimeout。返回取消函数 */
export function whenIdle(task: () => void, timeoutMs = 1500): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(task, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 200);
  return () => window.clearTimeout(id);
}
