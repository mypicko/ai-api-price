import { createHash } from "node:crypto";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { analyticsCspSources, parseAnalyticsConfig } from "./src/lib/analytics";
import { THEME_SCRIPT } from "./src/lib/theme-script";
import { normalizeBase } from "./src/lib/url";

const themeScriptHash = `sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}`;
// 可选访问统计：只把对应服务的域名加入 CSP（未配置时为空，策略不变）
const analytics = analyticsCspSources(parseAnalyticsConfig(process.env));

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL ?? "http://localhost:4321",
  base: normalizeBase(process.env.BASE_PATH),
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
  devToolbar: { enabled: false },
  security: {
    // 安全项 S12：只允许同源脚本 + 构建时计算出的内联脚本哈希
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src ${["'self'", ...analytics.connect].join(" ")}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: {
        resources: ["'self'", ...analytics.script],
        hashes: [themeScriptHash as `sha256-${string}`],
      },
      styleDirective: { resources: ["'self'"] },
    },
  },
});
