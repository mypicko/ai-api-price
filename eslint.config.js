import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".claude/**",
      "**/dist/**",
      "**/.astro/**",
      "**/node_modules/**",
      "data/**",
      "coverage/**",
      "**/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
);
