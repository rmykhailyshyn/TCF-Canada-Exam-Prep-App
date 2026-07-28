import { defineConfig } from "vitest/config";

export default defineConfig({
  // Automatic JSX runtime so client .tsx render smoke tests transform without React in scope.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "scripts/**/*.test.ts",
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      // Repo-tooling invariants (e.g. the e2e harness config pinned by
      // tools/e2e-runtime-invariants.test.ts).
      "tools/**/*.test.ts",
    ],
    // spec: docs/specs/test-coverage.md §Behaviour.1 (istanbul provider + machine-readable reports)
    // Coverage only runs when invoked with --coverage (npm run coverage:unit); plain `npm test`
    // is unaffected — this block is inert config until the flag is passed.
    coverage: {
      provider: "istanbul",
      include: ["client/src/**", "server/**", "scripts/**"],
      exclude: [
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.test.*",
        "e2e/**",
        "server/db/migrations/**",
        "**/*.config.*",
        "**/*.d.ts",
        "node_modules/**",
        "dist/**",
        "coverage/**",
        "tools/**",
        // Shared test harnesses (fixture DB, in-memory runtime doubles, fetch stub), not product code.
        "server/test-support/**",
        "client/src/test-support/**",
        // spec: docs/specs/test-coverage.md §Behaviour.4 (third-party paths) + §Scope (the TS/TSX
        // codebase only). `scripts/**` otherwise sweeps in the gitignored Python venv for the import
        // pipeline, whose site-packages vendor third-party JS (torch/preact/htm, urllib3) — ~450
        // uncovered lines of code this project does not own.
        "scripts/.venv/**",
        // spec: docs/specs/test-coverage.md §Behaviour.4 (revised 2026-07-27)
        // Process entrypoints: argv/`process`-level shells with no importable surface. They are
        // exercised by the e2e suite and by manual runs, not by unit tests, so counting them made
        // the unit figure measure reachability rather than test quality.
        "scripts/ocr.ts",
        "scripts/transcribe.ts",
        "scripts/enrich.ts",
        "scripts/deploy-content.ts",
        "scripts/import-writing.ts",
        "scripts/import-speaking.ts",
        "scripts/seed-dev.ts",
        "scripts/seed-listening-dev.ts",
        "scripts/migrate-media-paths.ts",
        "scripts/coverage-combine.ts",
        "scripts/coverage-e2e-server-report.ts",
        "server/index.ts",
        "server/db/migrate.ts",
        // Top-level-await module singleton, imported only by the scripts/ CLI tooling above.
        "server/db/index.ts",
        "client/src/main.tsx",
      ],
      reporter: ["text", "json", "json-summary", "lcov"],
      reportsDirectory: "coverage/unit",
      // Emit the machine-readable report even when tests fail, so CI can read the
      // coverage artifact independently of the pass/fail gate.
      reportOnFailure: true,
      // spec: docs/specs/test-coverage.md §Behaviour.7 (revised 2026-07-27 — per-suite unit gate
      // alongside the combined .nycrc.json one). `npm run coverage:unit` exits non-zero below these.
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
});
