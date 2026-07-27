import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// spec: docs/specs/test-coverage.md §Behaviour.3 (single merged report over unit + e2e client + server)
// spec: docs/specs/test-coverage.md §Behaviour.6 (common istanbul format, deterministic merge)
// spec: docs/specs/test-coverage.md §Behaviour.7 (threshold enforcement — exit non-zero below the minimum)
//
// Orchestrates the COMBINED coverage figure from the three per-suite istanbul JSON sources produced
// earlier in the pipeline (all keyed by absolute source path, so they merge cleanly):
//   - unit          : coverage/unit/coverage-final.json          (vitest istanbul provider)
//   - e2e client    : coverage/e2e-client/*.json                 (vite-plugin-istanbul window.__coverage__)
//   - e2e server    : coverage/e2e-server/coverage-final.json    (c8 → istanbul json)
//
// Steps: gather every source json into a single nyc temp-dir → `nyc merge` (one combined artifact) →
// `nyc report` (text-summary + lcov + json under coverage/combined/) → `nyc check-coverage` (per-metric
// threshold from .nycrc.json). nyc reads temp-dir / report-dir / reporter / thresholds from .nycrc.json.

const require = createRequire(import.meta.url);
const nycBin = require.resolve("nyc/bin/nyc.js");

const repoRoot = process.cwd();
const tempDir = resolve(repoRoot, "coverage/combined/.nyc_output");
const combinedJson = resolve(repoRoot, "coverage/combined/coverage-final.json");

const sources: { label: string; files: string[] }[] = [
  {
    label: "unit",
    files: [resolve(repoRoot, "coverage/unit/coverage-final.json")],
  },
  {
    label: "e2e-server",
    files: [resolve(repoRoot, "coverage/e2e-server/coverage-final.json")],
  },
  {
    label: "e2e-client",
    files: (() => {
      const dir = resolve(repoRoot, "coverage/e2e-client");
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => resolve(dir, f));
    })(),
  },
];

function log(msg: string): void {
  // eslint-disable-next-line no-console -- developer-facing tooling output.
  console.log(msg);
}

function runNyc(args: string[]): number {
  const res = spawnSync(process.execPath, [nycBin, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return res.status ?? 1;
}

function main(): void {
  // Deterministic: start from a clean temp-dir so stale runs never pollute the merge.
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  let copied = 0;
  for (const src of sources) {
    src.files.forEach((file, i) => {
      if (!existsSync(file)) {
        log(`WARN: missing ${src.label} coverage source: ${file}`);
        return;
      }
      // Stable, unique names so nyc merge sees every source once.
      cpSync(file, resolve(tempDir, `${src.label}-${String(i)}.json`));
      copied += 1;
    });
  }

  if (copied === 0) {
    log("ERROR: no coverage sources found to merge.");
    process.exit(1);
  }
  log(`Gathered ${String(copied)} istanbul source file(s) into ${tempDir}`);

  // One combined machine-readable artifact.
  const mergeStatus = runNyc(["merge", tempDir, combinedJson]);
  if (mergeStatus !== 0) process.exit(mergeStatus);

  // Text summary + lcov + json under coverage/combined/ (reporters/report-dir from .nycrc.json).
  const reportStatus = runNyc(["report"]);
  if (reportStatus !== 0) process.exit(reportStatus);

  // Per-metric threshold enforcement (lines/branches/functions/statements from .nycrc.json).
  const checkStatus = runNyc(["check-coverage"]);
  process.exit(checkStatus);
}

main();
