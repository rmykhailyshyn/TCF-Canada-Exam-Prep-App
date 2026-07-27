# ADR 0006: Test coverage via a common istanbul format, merged locally

- Status: accepted
- Date: 2026-07-25

## Context

The repo has two independent test suites — vitest (`server/`, `scripts/`, `client/` unit
+ render tests) and Playwright (`e2e/`, driving the running app) — and neither reports how
much of the codebase it exercises. Milestone 18 part (b) adds coverage to both, records a
baseline, and enforces a gate threshold. The suites collect coverage by different
mechanisms (in-process instrumentation vs. a running browser + a running Node server), so
a **single combined figure** requires all three sources to land in one mergeable format.

## Decision

Standardise every source on a **common istanbul/lcov format** and **merge locally**:

- **Unit (vitest)** — switch to the **`@vitest/coverage-istanbul`** provider, dropping
  `@vitest/coverage-v8`, so the unit report is istanbul-native (no v8→istanbul conversion).
- **e2e client** — an istanbul-instrumented client build via **`vite-plugin-istanbul`**,
  gated by `COVERAGE=1` (so plain `dev`/`build` are byte-for-byte unchanged), collecting
  `window.__coverage__` after the Playwright run.
- **e2e server** — the Node server run under **`c8`** (source-map aware) wrapping a
  dedicated coverage web-server, producing an istanbul-compatible report.
- **Combine** — merge unit + e2e client + e2e server and run the per-metric threshold
  check with **`nyc`** (merge + `check-coverage`), seeded at/just under the measured
  baseline so the gate is green on day one.

**Rejected alternatives:** Chromium `page.coverage` alone — client-only and doesn't merge
cleanly with istanbul server/unit data; a hosted dashboard (Codecov) — rejected on the
local-first, no-SaaS constraint.

## Consequences

- One common format means unit and e2e results merge into a single reported total via
  `nyc`/`istanbul-lib-coverage` without a separate v8→istanbul conversion step for the
  unit + e2e-client sources. The merge is deterministic (same inputs → same total), but the
  combined figure is a **floor to ratchet, not a precise truth**: server files exercised by
  BOTH the unit run (istanbul-native instrumentation) and the e2e-server run (`c8`, V8→istanbul-
  converted) are merged by statement key across possibly-misaligned statement maps, so their
  combined per-file statement/branch counts are an approximation. Acceptable for a threshold
  gate seeded at the measured baseline; a truer figure would require both halves to share one
  instrumenter.
- Istanbul instrumentation is **slower** than v8's built-in coverage — accepted for the
  merge benefit; the cost is confined to the coverage runs, not plain `test`/`build`.
- A **dedicated `c8`-wrapped coverage web-server** keeps plain `test:e2e` and the
  `E2E_DATABASE_URL` DB isolation (`e2e/global-setup.ts`) untouched — coverage wiring only
  engages under the coverage scripts.
- All artifacts land under a gitignored `coverage/` (+ `.nyc_output/`); only config and
  the recorded baseline number are committed.
