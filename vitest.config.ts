import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "packages/site/tests/e2e/**"],
    coverage: {
      provider: "v8",
      include: ["packages/shared/src/**", "packages/pipeline/src/**", "packages/site/src/lib/**"],
      exclude: ["packages/pipeline/src/index.ts", "packages/pipeline/src/core/browser.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
