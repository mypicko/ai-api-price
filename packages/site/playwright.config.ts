import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? 4329);

/**
 * E2E：基于 astro preview 运行（STYLE §12），使用 fixture 数据。
 * webServer 会先用 DATA_DIR=tests/fixtures/data 构建一次。
 * --ignore-lock：Astro 7 在检测到 AI agent 时会把 preview 自动放到后台，导致 Playwright 认为进程提前退出。
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: `./node_modules/.bin/astro build && exec ./node_modules/.bin/astro preview --port ${PORT} --ignore-lock`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATA_DIR: "tests/fixtures/data",
      PLANS_DIR: "tests/fixtures/plans",
      SITE_URL: `http://localhost:${PORT}`,
      BASE_PATH: "/",
      ASTRO_TELEMETRY_DISABLED: "1",
    },
  },
});
