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
      ],
      reporter: ["text", "json", "lcov"],
      reportsDirectory: "coverage/unit",
      // Emit the machine-readable report even when tests fail, so CI can read the
      // coverage artifact independently of the pass/fail gate.
      reportOnFailure: true,
    },
  },
});
