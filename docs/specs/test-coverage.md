# Spec: Test-Coverage Tracking (unit + e2e)

## Status

approved

> Milestone 18, part (b). Measures and reports code coverage for **both** test suites — the vitest
> unit/render suite (`npm test`) and the Playwright end-to-end suite (`npm run test:e2e`) — and **fails
> the quality gate below a configured threshold**. Developer-facing tooling only: no application
> behaviour, data model, or runtime code path changes. Makes untested surface area quantified rather
> than guessed at, so reliability work can be targeted.

## Goal

The repo has two independent test suites — vitest (`server/`, `scripts/`, `client/` unit + render
tests) and Playwright (`e2e/`, driving the running app) — but neither reports how much of the codebase
it exercises. This spec adds coverage measurement to both, records a **baseline**, and **enforces a
minimum threshold in the gate** so tested surface cannot silently regress. `@vitest/coverage-v8` is
already a devDependency, so unit coverage is largely configuration; e2e coverage is the harder half and,
per the approved decision, covers **both the client and the server** exercised by the e2e flows. All
tooling stays local-first (no hosted dashboard) and Node-native.

## Scope

- In scope:
  - Unit/render coverage for the vitest suite: enable a coverage provider in `vitest.config.ts`, add a
    coverage npm script, define the included/excluded source set, and emit a report.
  - End-to-end coverage from the Playwright run covering **both** halves of the app while the suite
    drives it:
    - **client** — via an istanbul-instrumented client build (`vite-plugin-istanbul`), collecting
      `window.__coverage__` after the e2e run;
    - **server** — by running the Node server process under V8 coverage (`c8`, Node-native) during the
      e2e run and converting to an istanbul-compatible report.
  - A **combined** coverage report merging unit + e2e (client + server) into one figure, using a common
    istanbul/`lcov` format (see Behaviour.6 / Open questions), plus the per-suite reports underneath.
  - A report format and output location (human-readable text summary + machine-readable `lcov`/`json`),
    written under a **gitignored** output directory (e.g. `coverage/`).
  - Recording a **baseline** coverage figure at introduction (in `docs/milestones.md` / runbook).
  - **Threshold enforcement in the gate**: a configured minimum (lines/branches/functions %) below
    which the coverage command exits non-zero; the initial threshold is set at or just under the
    recorded baseline so the gate starts green and ratchets up over time.
  - A short CLAUDE.md `## Commands` runbook entry: how to generate and read each report, and how to
    adjust the threshold.
- Out of scope:
  - Writing new tests to raise coverage (measurement + threshold first; targeted test-writing is
    follow-up work — the initial threshold is set to the baseline, not an aspirational number).
  - A hosted coverage dashboard or third-party SaaS (e.g. Codecov) — local reports only, local-first.
  - Coverage of the Python import helpers (`scripts/*.py`) — the TS/TSX codebase only.
  - Static analysis (Milestone 18 part (a); see `static-analysis.md`).
  - Mutation testing or any coverage-quality metric beyond line/branch/function coverage.

## Behaviour

_Developer-facing: "the user" is the developer running the repo's tooling._

1. Running the unit-coverage command (e.g. `npm run coverage:unit`) runs the vitest suite with coverage
   and produces a report: a printed text summary (per-file + total line/branch/function %) plus a
   machine-readable report file under the gitignored output dir.
2. Running the e2e-coverage command (e.g. `npm run coverage:e2e`) runs the Playwright suite with
   coverage collection enabled for **both** the client (istanbul-instrumented build) and the server
   (Node under `c8`), and produces machine-readable reports for the code exercised by the e2e flows.
3. Running the combined-coverage command (e.g. `npm run coverage`) produces a **single merged report**
   over unit + e2e (client + server) plus a printed total, from the common istanbul/`lcov` format.
4. Coverage counts the project's own source (`client/src/**`, `server/**`, `scripts/**` `.ts`/`.tsx`)
   and **excludes** non-source and generated/third-party paths: `node_modules/`, `dist/`, test files
   themselves (`**/*.test.ts(x)`, `e2e/**`), generated migrations (`server/db/migrations/**`), config
   files, and type-only declaration files.
5. All coverage **output artifacts are written under a gitignored directory** (e.g. `coverage/`) and are
   never committed; only the configuration and the recorded baseline number are committed.
6. The reports are produced in a **common istanbul/`lcov` format** so unit and e2e results are
   mergeable into the combined figure; the merge is deterministic and documented.
7. **Threshold enforcement:** the coverage command exits non-zero when total coverage is below the
   configured minimum, and zero at/above it. The threshold is committed in config and part of the
   quality gate.
8. Generating coverage does **not** change how the plain `npm test` / `npm run test:e2e` commands behave
   when run **without** the coverage script — the existing suites and the e2e DB isolation (dedicated
   `tcf_prep_e2e` DB, `e2e/global-setup.ts`, Chromium-only) are unaffected.
9. A baseline coverage figure is recorded at introduction, and the initial threshold is set at/just
   under it so the gate is green on day one and can be ratcheted upward later.
10. The runbook documents how to run each coverage command, where the reports land, how to read them,
    and how to change the threshold.

## Data model changes

None. Tooling only.

## API contract

None. No runtime routes or endpoints are added or changed.

## Acceptance criteria

Testable pass/fail conditions. Each maps back to a behaviour above.

- [ ] A unit-coverage command runs the vitest suite with coverage and emits a text summary + a machine-readable report under the gitignored output dir. (Behaviour.1)
- [ ] An e2e-coverage command runs the Playwright suite collecting **both** client (istanbul-instrumented build) and server (`c8`) coverage, and emits reports for the exercised code. (Behaviour.2; Open Q1 resolved)
- [ ] A combined command merges unit + e2e (client + server) into one report + printed total from a common istanbul/`lcov` format. (Behaviour.3, Behaviour.6)
- [ ] Coverage includes `client/src/**`, `server/**`, `scripts/**` source and excludes `node_modules/`, `dist/`, test files, `e2e/**`, generated migrations, config, and `.d.ts` files. (Behaviour.4)
- [ ] All coverage output lands under a gitignored directory (e.g. `coverage/`); `.gitignore` is updated; no report artifact is committed. (Behaviour.5)
- [ ] The coverage command **fails (non-zero)** below the configured minimum and passes at/above it; the threshold is committed and part of the gate. (Behaviour.7; Open Q2 resolved)
- [ ] Plain `npm test` and `npm run test:e2e` (no coverage script) behave exactly as before, and e2e DB isolation is unchanged. (Behaviour.8)
- [ ] A baseline coverage figure is recorded and the initial threshold is set at/just under it so the gate starts green. (Behaviour.9)
- [ ] CLAUDE.md `## Commands` documents the coverage commands, output location, reading, and threshold adjustment. (Behaviour.10)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` still pass. (all)

## Open questions

1. ~~**E2e collection mechanism / client-only vs. server too.**~~ **Resolved 2026-07-25:** cover
   **both** client and server during e2e. Client via `vite-plugin-istanbul` (instrumented coverage
   build → `window.__coverage__`); server by running the Node server under `c8` (Node-native V8
   coverage → istanbul-compatible report). Chromium `page.coverage` alone is rejected because it is
   client-only and doesn't merge cleanly with istanbul.
2. ~~**Threshold enforcement.**~~ **Resolved 2026-07-25:** enforce a **minimum threshold that fails the
   gate**. The initial value is set at/just under the recorded baseline (so day-one green) and ratcheted
   upward over time — not an aspirational number that blocks work immediately.
3. **Provider consistency for the merge.** To merge unit + e2e into one istanbul/`lcov` figure, vitest
   likely needs its **istanbul** provider (rather than the installed `v8` provider) for a common format,
   or a v8→istanbul conversion step. Which: switch vitest to `@vitest/coverage-istanbul`, or keep `v8`
   and convert? (Affects which devDependency is added.)
4. **Threshold granularity + initial number.** One overall lines threshold, or per-metric
   (lines/branches/functions), and enforced on the **combined** figure only or per-suite too? The exact
   baseline number is measured during implementation and recorded then.
5. **Coverage in the gate vs. CI.** The combined coverage run is confirmed as a gate step; also add it
   to CI? No CI workflow exists yet — introducing one is a separate decision (shared with
   `static-analysis.md` Open Q6).
6. **E2e server coverage wiring.** Running the dev server under `c8` during `test:e2e` means the
   Playwright `webServer.command` (`npm run dev`) is wrapped for the coverage run only, without
   disturbing the normal `test:e2e` invocation or the `E2E_DATABASE_URL` isolation. Confirm the wrapping
   approach (a dedicated coverage web-server command) at implementation time.

## Revision history

- 2026-07-25: Initial draft (Milestone 18, part b).
- 2026-07-25: Resolved Open Q1 (cover both client + server during e2e — `vite-plugin-istanbul` for the
  client, `c8` for the server) and Q2 (enforce a gate-failing minimum threshold, seeded at the baseline)
  per the human's decisions; Goal/Scope/Behaviour/AC updated for combined reporting + threshold gating.
  Status draft → approved.
