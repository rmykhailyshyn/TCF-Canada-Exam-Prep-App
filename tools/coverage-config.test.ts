// spec: docs/specs/test-coverage.md §Behaviour.1, §Behaviour.4 (coverage provider + include/exclude set)
import { describe, it, expect } from "vitest";
import vitestConfig from "../vitest.config";

// vitest.config.ts default-exports the object produced by defineConfig(...).
const coverage = (vitestConfig as { test?: { coverage?: Record<string, unknown> } })
  .test?.coverage;

describe("vitest.config.ts coverage block", () => {
  it("declares the istanbul provider", () => {
    expect(coverage).toBeDefined();
    expect(coverage?.provider).toBe("istanbul");
  });

  it("includes the project source roots", () => {
    expect(coverage?.include).toEqual(
      expect.arrayContaining(["client/src/**", "server/**", "scripts/**"]),
    );
  });

  it("excludes tests, e2e, generated migrations, config, and declaration files", () => {
    expect(coverage?.exclude).toEqual(
      expect.arrayContaining([
        "**/*.test.*",
        "e2e/**",
        "server/db/migrations/**",
        "**/*.d.ts",
      ]),
    );
  });
});
