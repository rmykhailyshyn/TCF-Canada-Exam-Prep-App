import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import invariants from "./tools/eslint-plugin-invariants/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.venv/**",
      "**/.venv-inspect/**",
      "server/db/migrations/**",
      "client/vite.config.ts",
    ],
  },
  // The `analyze` pass (eslint.analysis.config.js) carries security + invariant rules this style pass
  // does not run. Suppressing an analyze-only finding at its site (spec: static-analysis.md §Behaviour.6)
  // leaves a disable directive that this pass sees as "unused" — register the repo-local invariants
  // plugin so those `invariants/*` ids resolve here, and stop reporting cross-pass directives as unused,
  // so a legitimate analyze suppression never fails the style lint.
  { plugins: { invariants }, linterOptions: { reportUnusedDisableDirectives: "off" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Repo-owned config + tooling scripts (this file, eslint.analysis.config.js, the invariants plugin)
  // run under Node — give them the Node globals so `process` etc. are defined.
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: [
      "server/**/*.ts",
      "scripts/**/*.ts",
      "e2e/**/*.ts",
      "*.config.ts",
      "drizzle.config.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
