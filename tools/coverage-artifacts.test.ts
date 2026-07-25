// spec: docs/specs/test-coverage.md §Behaviour.5, §Behaviour.7 (gitignored artifacts + committed threshold)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function read(rel: string): string | null {
  try {
    return readFileSync(join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}

describe(".gitignore ignores coverage artifacts", () => {
  const gitignore = read(".gitignore") ?? "";

  it("ignores the coverage/ output directory", () => {
    expect(gitignore).toMatch(/(^|\n)\/?coverage\/?(\s|$)/);
  });

  it("ignores the .nyc_output/ directory", () => {
    expect(gitignore).toMatch(/\.nyc_output/);
  });
});

describe("nyc threshold config", () => {
  // Threshold may live in .nycrc.json, .nycrc, or the package.json "nyc" key.
  function findNycConfig(): Record<string, unknown> | null {
    for (const rel of [".nycrc.json", ".nycrc"]) {
      const raw = read(rel);
      if (raw) {
        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          /* fall through */
        }
      }
    }
    const pkgRaw = read("package.json");
    if (pkgRaw) {
      const pkg = JSON.parse(pkgRaw) as { nyc?: Record<string, unknown> };
      if (pkg.nyc) return pkg.nyc;
    }
    return null;
  }

  it("declares per-metric coverage thresholds (lines/branches/functions)", () => {
    const nyc = findNycConfig();
    expect(nyc).not.toBeNull();
    expect(typeof nyc?.lines).toBe("number");
    expect(typeof nyc?.branches).toBe("number");
    expect(typeof nyc?.functions).toBe("number");
  });
});
