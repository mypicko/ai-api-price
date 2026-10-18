/**
 * Playwright 封装：懒加载单个 Chromium 实例，所有 browser 类源共用。
 * 只暴露 render()：打开页面 → 等待选择器 → 返回渲染后的 HTML。
 */
import type { Browser } from "playwright";
import { PipelineError } from "./errors";

export interface RenderOptions {
  /** 等待出现的选择器（STYLE C10：不要用固定等待时间） */
  readonly waitFor?: string;
  readonly timeoutMs?: number;
  /** 页面加载后执行的点击（例如切换 tab），按顺序执行 */
  readonly clicks?: readonly string[];
}

export interface BrowserClient {
  render(url: string, options?: RenderOptions): Promise<string>;
  close(): Promise<void>;
}

export interface BrowserClientOptions {
  readonly userAgent: string;
}

export function createBrowserClient(options: BrowserClientOptions): BrowserClient {
  let browserPromise: Promise<Browser> | null = null;

  async function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
      browserPromise = import("playwright")
        .then(({ chromium }) => chromium.launch({ headless: true }))
        .catch((error: unknown) => {
          browserPromise = null;
          throw new PipelineError("E1004", "Playwright 启动失败", { cause: error });
        });
    }
    return browserPromise;
  }

  return {
    async render(url, renderOptions = {}) {
      const timeoutMs = renderOptions.timeoutMs ?? 45_000;
      const browser = await getBrowser();
      const context = await browser.newContext({ userAgent: options.userAgent, locale: "zh-CN" });
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        if (renderOptions.waitFor) {
          await page.waitForSelector(renderOptions.waitFor, { timeout: timeoutMs });
        } else {
          await page.waitForLoadState("networkidle", { timeout: timeoutMs });
        }
        for (const selector of renderOptions.clicks ?? []) {
          await page.click(selector, { timeout: timeoutMs });
          await page.waitForLoadState("networkidle", { timeout: timeoutMs });
        }
        return await page.content();
      } catch (error) {
        if (error instanceof PipelineError) throw error;
        const isTimeout = error instanceof Error && error.name === "TimeoutError";
        throw new PipelineError(isTimeout ? "E1002" : "E2001", `页面渲染失败：${url}`, {
          cause: error,
        });
      } finally {
        await context.close();
      }
    },
    async close() {
      if (!browserPromise) return;
      const browser = await browserPromise.catch(() => null);
      browserPromise = null;
      await browser?.close();
    },
  };
}
