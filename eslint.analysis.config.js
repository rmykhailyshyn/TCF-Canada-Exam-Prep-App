// spec: docs/specs/static-analysis.md §Behaviour.1-5,9 (security + project-invariant analysis pass)
//
// Dedicated security + invariants ESLint pass, run via `npm run analyze`, SEPARATE from the style
// `lint` (eslint.config.js). Combines:
//   - eslint-plugin-security (Node-oriented SAST) on server/scripts,
//   - eslint-plugin-no-unsanitized (DOM XSS sinks) on the client,
//   - type-aware typescript-eslint (recommendedTypeChecked) for .ts(x), disabled on .js/config,
//   - the repo-local `invariants` plugin (CLAUDE.md project invariants).
// Blocking severity is `error`; the advisory no-any-without-comment rule is `warn` (spec Open Q5).

import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import nounsanitized from "eslint-plugin-no-unsanitized";
import globals from "globals";
import invariants from "./tools/eslint-plugin-invariants/index.js";

// Type-aware linting requires the typescript program (parserOptions.projectService) — enabled for the
// real `npm run analyze` CLI pass. The invariant-rule unit harness (analysis-config.test.ts) runs
// under vitest and deliberately disables type-aware parsing (project/projectService: false) to test
// the AST-based invariant rules in isolation; enabling the type-checked rules there would make them
// throw for lack of a program. So the type-aware layer is skipped under vitest — the security +
// invariant layers (the subject of the test) always run.
const TYPE_AWARE = !process.env.VITEST;

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.venv/**",
      "**/.venv-inspect/**",
      "**/coverage/**",
      "server/db/migrations/**",
      "client/vite.config.ts",
      "data/**",
      "**/*.d.ts",
      "tools/eslint-plugin-invariants/**/*.test.ts",
    ],
  },

  // Base: parse all TS/TSX with the typescript-eslint parser (needed by the invariant rules, which
  // reason over TS AST like TSAnyKeyword) regardless of whether the type-aware layer is active.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
  },

  // Type-aware correctness/safety layer for TS sources. projectService discovers the nearest
  // tsconfig. Scoped so plain JS/config files (below) opt back out of type-checking.
  ...(TYPE_AWARE
    ? [
        {
          // Type-aware layer scoped to the sources covered by a committed tsconfig program. Uses the
          // explicit `project` list (not `projectService`) so files that live outside their own
          // directory's tsconfig are still associated: scripts/** is part of server/tsconfig.json
          // (`../scripts/**/*.ts`), and the Worker entry + R2 store are in server/tsconfig.worker.json.
          // e2e/** is intentionally omitted — it belongs to no tsconfig and is not type-checked by the
          // normal gate either — so it gets the (program-free) security/invariant layers only, never a
          // "file not found by the project service" parse error. spec: static-analysis.md §Behaviour.1
          files: ["client/**/*.{ts,tsx}", "server/**/*.ts", "scripts/**/*.ts"],
          extends: [...tseslint.configs.recommendedTypeChecked],
          languageOptions: {
            parserOptions: {
              project: [
                "./client/tsconfig.json",
                "./server/tsconfig.json",
                "./server/tsconfig.worker.json",
              ],
              tsconfigRootDir: import.meta.dirname,
            },
          },
        },
        // Plain JS + config files: no type information, so switch off type-checked rules.
        {
          files: ["**/*.{js,cjs,mjs}"],
          extends: [tseslint.configs.disableTypeChecked],
        },
      ]
    : []),

  // Security SAST heuristics on Node-executed code.
  {
    files: ["server/**/*.{ts,tsx}", "scripts/**/*.ts"],
    languageOptions: { globals: globals.node },
    plugins: { security },
    rules: { ...security.configs.recommended.rules },
  },

  // Client DOM-XSS sinks.
  {
    files: ["client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: nounsanitized.configs.recommended.plugins,
    rules: { ...nounsanitized.configs.recommended.rules },
  },

  // Repo-local project invariants (CLAUDE.md). Rules self-scope by path internally, so enabling them
  // across the server/scripts trees is safe. Structural invariants block (error); the advisory
  // no-any rule warns.
  {
    files: ["server/**/*.{ts,tsx}", "scripts/**/*.ts"],
    plugins: { invariants },
    rules: {
      "invariants/portable-core-no-node-builtins": "error",
      "invariants/no-raw-sql": "error",
      "invariants/thin-route-handlers": "error",
      "invariants/shell-out-location": "error",
      "invariants/no-any-without-comment": "warn",
    },
  },

  // Test scaffolding (unit + render tests) is categorically outside the reach of these rules: tests
  // legitimately mock DB clients, import node:fs to build fixtures, run static PRAGMAs, and stub async
  // methods that never await. The security SAST heuristics, the cross-file project invariants, and the
  // strict type-aware safety rules all target shipped production code, so they are disabled here — the
  // production sources they protect are still fully covered above. spec: static-analysis.md §Behaviour.9
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.ts"],
    rules: {
      "invariants/portable-core-no-node-builtins": "off",
      "invariants/no-raw-sql": "off",
      "invariants/thin-route-handlers": "off",
      "invariants/shell-out-location": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-child-process": "off",
      "security/detect-object-injection": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
