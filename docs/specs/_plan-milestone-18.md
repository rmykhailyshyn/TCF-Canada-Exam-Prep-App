# Implementation Plan — Milestone 18 (Reliability)

> Architect artifact. Covers TWO approved specs implemented together in one PR:
> - `docs/specs/static-analysis.md` — Node-native ESLint security + invariants pass (`npm run analyze`), blocking gate.
> - `docs/specs/test-coverage.md` — unit (vitest) + e2e (client istanbul + server c8) coverage, combined report + threshold gate.
>
> **Do not start coding** until the human validates this plan AND answers the `TODO: confirm`
> items below. Both specs are `Status: approved` (approval gate satisfied, CLAUDE.md Rule 3).

---

## 1. Approval gate

- `static-analysis.md` → `approved` ✓
- `test-coverage.md` → `approved` ✓

Both may be handed to the Developer phases once this plan is validated. No self-approval performed.

---

## 2. Reconciliation note (specs vs. repo reality)

### ESLint (the base the security pass extends)
- Flat config at **`eslint.config.js`** (root, single file). Layers: `@eslint/js` recommended +
  `...tseslint.configs.recommended` (**NOT type-aware** — no `parserOptions.project`/`projectService`
  today) + a client block (`react-hooks` recommended, `react-refresh/only-export-components` warn).
- `npm run lint` = **`eslint .`** (style/hooks/type layer — stays unchanged, per spec Scope "out of scope").
- Ignores: `**/dist/**`, `**/node_modules/**`, `**/.venv/**`, `**/.venv-inspect/**`,
  `server/db/migrations/**`, `client/vite.config.ts`.
- Existing inline suppressions: **only 2** (`server/db/factory.ts`, `server/routes/practice-routes.test.ts`,
  both `@typescript-eslint/no-explicit-any` with rationale). Base repo is clean under the current rules —
  but the NEW security + **type-aware** layer will surface fresh findings needing triage (Behaviour.9).
- **Reconciliation flag:** the spec asks for "type-aware `typescript-eslint` rules." The current config is
  NOT type-aware. The analysis config must add `languageOptions.parserOptions.projectService` (or explicit
  `project: [client/tsconfig.json, server/tsconfig.json, server/tsconfig.worker.json]`) and
  `tseslint.configs.recommendedTypeChecked` for the TS files. This is heavier/slower and must be scoped so
  `.js`/config files are excluded from type-aware parsing (`tseslint.configs.disableTypeChecked` for them).

### package.json / scripts / deps
- Root is an npm **workspaces** repo (`client`, `server`). Root `package.json` holds all quality-gate scripts.
- Present: `@vitest/coverage-v8@^2.1.9` ✓ (confirmed), `eslint@^9`, `typescript-eslint@^8`, `vitest@^2.1.8`,
  `@playwright/test@^1.60`, `concurrently`, `tsx`, `vite@^6`.
- **Absent (must be added, pinned):** `eslint-plugin-security`, `eslint-plugin-no-unsanitized`,
  `vite-plugin-istanbul`, `c8`, and (for the merge) `@vitest/coverage-istanbul` and/or
  `nyc`/`istanbul-lib-coverage`.
- Quality-gate scripts today: `lint`, `typecheck` (client + server + worker tsconfig), `test` (`vitest run`),
  `build` (`vite build` + server worker typecheck), `test:e2e` (`playwright test`).

### vitest
- Single **`vitest.config.ts`** at root. `environment: "node"`, `esbuild.jsx: "automatic"`, include globs:
  `server/**/*.test.ts`, `scripts/**/*.test.ts`, `client/**/*.test.ts(x)`. **No `coverage` block yet.**
- ~20 unit/render test files across `server/`, `scripts/lib/`, `client/src/`.

### Playwright / e2e
- **`playwright.config.ts`**: `webServer.command = "npm run dev"`, `env: { DATABASE_URL: E2E_DATABASE_URL }`,
  `reuseExistingServer: false`, `baseURL: http://localhost:5173`, `globalSetup: ./e2e/global-setup.ts`.
- **`e2e/global-setup.ts`** derives `tcf_prep_e2e.db`, resets+migrates+seeds it, generates ffmpeg audio.
  DB isolation is via `DATABASE_URL` override on the webServer only — must remain untouched by coverage wiring.
- `npm run dev` = `concurrently` → `dev:server` (`tsx watch index.ts`) + `dev:client` (`vite`). Client on 5173
  proxies `/api` → server on 3001.
- e2e tests: `e2e/features/*.spec.ts`, `e2e/api/api.spec.ts`; page objects in `e2e/pages/`, fixtures in `e2e/fixtures/`.

### Portable-core boundary (for the `node:*` invariant rule) — verified precisely
- **`server/app.ts` (`createCoreApp`)**: mounts health/sessions/questions/writing/speaking routers. **Clean** —
  no `node:*` import.
- **`server/routes/**`**: all clean of `node:*` EXCEPT **`server/routes/node-routes.ts`** (the Node-only
  extension mounted only by the Node entry `server/index.ts` via `registerNodeRoutes`). `node-routes.ts` itself
  imports services, not `node:*` directly. `practice-routes.test.ts` imports `node:fs/os/path/url` (a test).
- **Nuance the spec's "no `node:*`" wording glosses over:** several **portable** services import `node:path`,
  which IS Worker-safe under `nodejs_compat`:
  - `server/services/questions.ts` → `node:path` (extname)
  - `server/services/speaking.ts` → `node:path` (extname)
  - `server/services/export-import.ts` → `node:path` (basename, join)
  - `server/config/env.ts` → `node:url`, `node:path`
  So a literal "ban all `node:*`" rule over services would **false-positive** on legitimate portable code.
  The Worker-forbidden modules the spec actually cares about are **`node:child_process`** and **`node:fs`**
  (and `node:stream`/`node:os` are effectively Node-only too). Genuinely Node-only modules that legitimately
  import them: `server/lib/claude-cli.ts` (child_process), `server/lib/llm-provider-node.ts`,
  `server/runtime/node-media-store.ts` (fs/stream), `server/services/speaking-node.ts`, `server/db/sqlite-path.ts`
  (fs), `server/db/migrate.ts`.
  → See **TODO: confirm Q-A3** for the exact restricted-module list and path scope.

### Drizzle / raw SQL
- All DB access goes through Drizzle query builders (`server/services/*`, `server/db/*`). `drizzle-orm`'s
  **`sql` tag is used legitimately** in `server/db/schema.ts` (defaults `sql\`(unixepoch())\``, check constraints).
- `server/lib/deploy-sql.ts` generates `INSERT OR REPLACE` **strings** on purpose (the content-deploy export tool)
  — a legitimate SQL-string producer that a naive "no raw SQL" rule would flag. → See **TODO: confirm Q-A2**.
- No `.execute("<string>")` / `db.run("<string>")` raw-execution sites found in app code.

### Shell-outs (child_process / whisper / tesseract)
- `child_process` used in: `server/lib/claude-cli.ts` (spawnSync), `scripts/lib/whisper.ts`,
  `scripts/lib/tesseract.ts` (via the scripts import pipeline), `e2e/global-setup.ts` (spawnSync — test infra).
  All inside `scripts/` or `server/services|lib/` wrappers → the "no shell-outs outside scripts/+services"
  invariant is already satisfied; the rule codifies it. NOTE `claude-cli.ts` is under `server/lib/`, not
  `server/services/` — the spec's allow-list wording ("`scripts/`+`server/services/`") must be widened to
  include `server/lib/` or `claude-cli.ts` will false-positive (**TODO: confirm Q-A4**).

### Vite build / gitignore
- **`client/vite.config.ts`**: `plugins: [react()]`, `/api` proxy. `vite-plugin-istanbul` must be added
  **gated by an env flag** (e.g. `COVERAGE=1`) so normal `npm run build`/`dev` are byte-for-byte unchanged
  (Behaviour.8).
- **`.gitignore`** already ignores `/test-results/`, `/playwright-report/`, `/blob-report/`, but **not**
  `coverage/` or `.nyc_output/` — those must be added.

---

## 3. Spec-vs-reality divergences (must resolve before/with implementation — CLAUDE.md Rule 4)

1. **CI already exists.** Both specs assert "No CI workflow currently exists in the repo"
   (`static-analysis.md` Open Q6; `test-coverage.md` Open Q5). **False.** `.github/workflows/ci.yml`
   runs `lint → typecheck → test → build` then an `e2e` job; `deploy.yml` also exists. This changes both
   Open Qs from "introducing CI is a separate decision" into a concrete, answerable question: **should
   `analyze` and `coverage` be added as CI steps in `ci.yml`?** → **TODO: confirm Q-C1**. Both specs'
   Revision history / Open Q text should be corrected to reflect that CI exists (a spec revision, not code).

2. **"no `node:*`" over-broad wording** vs. legitimate portable `node:path`/`node:url` use (see §2). The rule
   must target Worker-forbidden modules only; spec Scope wording should be tightened. → Q-A3.

3. **"no raw SQL" wording** vs. the legitimate `drizzle-orm` `sql` tag (schema.ts) and the deploy-sql export
   tool. Rule must allow the `sql` tag and the export tool. → Q-A2.

4. **shell-out allow-list** must include `server/lib/` (claude-cli.ts), not just `scripts/`+`server/services/`. → Q-A4.

These are wording/scoping refinements to already-approved specs; recommend a one-line spec revision note per
spec (Rule 4) rather than silently encoding a narrower rule. None blocks planning.

---

## 4. Trade-offs / ADR flags

### ADR-worthy (durable, cross-cutting — propose writing to `docs/adr/`)
- **ADR-0005 — Node-native SAST via ESLint (reject Semgrep/CodeQL/njsscan).** Already "resolved" in
  static-analysis Open Q1, but it is a durable, cross-cutting tooling/methodology decision that outlives the
  spec. Recommend capturing as an ADR (Status: accepted) so the "no extra toolchain" constraint is discoverable.
- **ADR-0006 — Coverage via a common istanbul format, merged locally.** The choice of provider + merge
  mechanism (vitest istanbul provider, `vite-plugin-istanbul` for e2e client, `c8` for e2e server, merged with
  istanbul-lib-coverage/nyc) is durable architecture with real consequences (build instrumentation, dev-server
  wrapping). Recommend an ADR.

### Design decisions the specs force
| Decision | Options | Recommendation (for confirmation) |
| --- | --- | --- |
| vitest provider for merge (test-coverage Q3) | keep `v8` + convert to istanbul; OR switch to `@vitest/coverage-istanbul` | **Switch to `@vitest/coverage-istanbul`** → one common format, deterministic merge, no conversion step. Trade-off: istanbul instrumentation is slower than v8 and `@vitest/coverage-v8` becomes unused (remove or keep). → Q-B1 |
| Merge mechanism (Behaviour.6) | `nyc merge` + `nyc report`/`check-coverage`; OR custom `istanbul-lib-coverage` script | **`nyc`** (bundles merge + report + `check-coverage` threshold) unless we prefer zero extra dep → small `istanbul-lib-coverage` script. → Q-B2 |
| e2e **server** coverage wrapping (test-coverage Q6) | `c8 npm run dev` (c8 sets `NODE_V8_COVERAGE`, inherited by the tsx server child); OR a dedicated `dev:server` coverage variant | Dedicated **coverage web-server command** (e.g. `webServer.command` swapped to a `dev:coverage` script only under a `COVERAGE` env) so `E2E_DATABASE_URL` isolation and plain `test:e2e` are untouched (Behaviour.8). c8 + tsx needs source maps to map to `.ts`. → Q-B3 |
| e2e **client** instrumentation | `vite-plugin-istanbul` gated by `COVERAGE=1`, collect `window.__coverage__` after the run | Add a Playwright teardown/fixture that writes `window.__coverage__` to `coverage/e2e-client/` per page. → Q-B4 |
| Blocking severity (static-analysis Q5) | error blocks; `any`-without-comment + low-signal at `warn` | Confirm: **error blocks, advisory rules `warn`** (`analyze` runs with `--max-warnings` unset so warns don't fail, OR a separate reported-but-non-blocking channel). → Q-A5 |
| Custom-rule surface (static-analysis Q4) | full list; OR high-value few first | Start with **portable-core purity + no-raw-SQL + thin-route (no DB/child_process in routes) + shell-out-location**; `any`-without-comment as advisory `warn`. → Q-A1 |
| Threshold granularity + number (test-coverage Q4) | overall lines only vs per-metric; combined-only vs per-suite | Recommend **per-metric on the combined figure**, seeded at/just under the measured baseline. Number measured at implementation. → Q-B5 |

---

## 5. Task graph (ordered; one PR)

Tracks **A** (static-analysis) and **B** (coverage) are largely independent and may proceed in parallel, but
ship together. Task 0 and Task 9 are shared.

**T0 — Reconciliation + ADRs (shared, do first).**
- Correct both specs' CI Open Q (CI exists) and tighten the `node:*`/raw-SQL/shell-out wording (Rule 4 revision notes).
- Write `docs/adr/0005-node-native-sast-eslint.md` and `docs/adr/0006-coverage-common-istanbul-format.md`
  (Status accepted); add both to `docs/adr/README.md` index.
- **Depends on:** human answers to the `TODO: confirm` items. **Verify:** docs only — review.

### Track A — static-analysis
**A1 — Install + pin SAST deps.** Add `eslint-plugin-security`, `eslint-plugin-no-unsanitized` (pinned) to root
devDeps; lockfile committed.
- **Depends on:** T0. **Verify:** `npm ci` clean; versions pinned (Behaviour.8, AC "Node-native/offline").

**A2 — `eslint.analysis.config.js` security layer.** New dedicated flat config: reuse the base ignores (+ any
media/data paths), enable `eslint-plugin-security` (Node files), `eslint-plugin-no-unsanitized` (client),
and **type-aware** `typescript-eslint` (`recommendedTypeChecked` + `parserOptions.projectService`; disable
type-checking for `.js`/config). Add `analyze` script (`eslint -c eslint.analysis.config.js .`).
- **Depends on:** A1. **Verify:** `npm run analyze` runs and prints findings; a fixture with an unsafe
  `child_process`/regex is flagged (AC Behaviour.1/2/3/4).

**A3 — Repo-local invariant rule plugin.** A small local ESLint plugin (e.g. `eslint-rules/` or
`tools/eslint-plugin-invariants/`) with rules, each with stable id + invariant-referencing message + severity:
- `portable-core-no-node-builtins` (path-scoped: forbid `node:child_process`/`node:fs`/`node:stream` in the
  portable set; exempt list per Q-A3) — likely `no-restricted-imports` per-path-glob rather than a custom rule.
- `no-raw-sql` (forbid raw SQL execution strings; allow the `sql` tag + deploy-sql tool) — custom rule.
- `thin-route-handlers` (no direct DB/`child_process` in `server/routes/**` except node-routes.ts) — custom rule
  or `no-restricted-syntax`/`no-restricted-imports`.
- `shell-out-location` (child_process/whisper/tesseract only under `scripts/`, `server/services/`, `server/lib/`) — path-scoped restriction.
- `no-any-without-comment` — advisory `warn` (Q-A5).
- **Depends on:** A1. **Verify:** `RuleTester` unit tests (valid + invalid fixtures) per custom rule; a crafted
  violation is reported by the right rule id (AC Behaviour.5).

**A4 — Triage to green.** Run `analyze`; fix or suppress-with-rationale every pre-existing finding so the pass
exits 0 on the clean repo.
- **Depends on:** A2, A3. **Verify:** `npm run analyze` exits 0 on `main` (AC Behaviour.9); suppression carries rationale (Behaviour.6).

**A5 — Gate wiring + docs (Track A).** Add `analyze` to the documented quality gate; CLAUDE.md `## Commands`
runbook (run/read/triage/add-a-rule/suppress). Optionally add to `ci.yml` (Q-C1).
- **Depends on:** A4. **Verify:** gate list updated; a fixture violation makes `analyze` exit non-zero (AC Behaviour.2/10).

### Track B — coverage
**B1 — Unit coverage (vitest).** Add coverage provider to `vitest.config.ts` (istanbul per Q-B1), define
include (`client/src/**`, `server/**`, `scripts/**` `.ts(x)`) / exclude (`**/*.test.*`, `e2e/**`,
`server/db/migrations/**`, `*.config.*`, `**/*.d.ts`, `node_modules`, `dist`), reporters (text + json/lcov),
`reportsDirectory: coverage/unit/`. Add `coverage:unit` script.
- **Depends on:** T0. **Verify:** `npm run coverage:unit` prints summary + writes `coverage/unit/` json/lcov (AC Behaviour.1/4).

**B2 — e2e client coverage.** Add `vite-plugin-istanbul` to `client/vite.config.ts` gated by `COVERAGE=1`;
Playwright fixture/teardown collects `window.__coverage__` → `coverage/e2e-client/`. Plain `test:e2e` unaffected.
- **Depends on:** B1 (shared exclude set). **Verify:** with the coverage script, `coverage/e2e-client/` json is
  produced; without it, `npm run build`/`test:e2e` unchanged (AC Behaviour.2/8).

**B3 — e2e server coverage.** Dedicated coverage web-server command running the Node server under `c8`
(source-map aware) writing to `coverage/e2e-server/`; wired only when the coverage e2e script runs, preserving
`E2E_DATABASE_URL` isolation (Q-B3/Q-B6).
- **Depends on:** B1. **Verify:** `coverage/e2e-server/` json produced after the coverage e2e run; DB isolation
  + plain `test:e2e` unchanged (AC Behaviour.2/8).

**B4 — Combined merge + threshold gate.** `coverage:e2e` (runs B2+B3), `coverage` (merges unit + e2e client +
e2e server via nyc/istanbul-lib-coverage → `coverage/combined/`, prints total), threshold check (per-metric,
seeded at baseline) exiting non-zero below it. Add `coverage`/`coverage:e2e` scripts.
- **Depends on:** B1, B2, B3. **Verify:** merged report + printed total; below-threshold config makes it exit
  non-zero, at/above exits 0 (AC Behaviour.3/6/7).

**B5 — Baseline + gitignore + docs (Track B).** Record measured baseline in `docs/milestones.md`; set initial
threshold at/just under it; add `coverage/`, `.nyc_output/` to `.gitignore`; CLAUDE.md `## Commands` runbook.
Optionally add to `ci.yml` (Q-C1).
- **Depends on:** B4. **Verify:** gate green day one; no artifacts committed; runbook present (AC Behaviour.5/9/10).

**T9 — Whole-gate regression (shared, last).** Confirm `typecheck`, `lint`, `test`, `build`, `test:e2e`,
`analyze`, `coverage` all pass on the branch.
- **Depends on:** A5, B5. **Verify:** all gate commands green (both specs' final AC).

Ordering: **T0 → {A1→A2/A3→A4→A5} ‖ {B1→B2/B3→B4→B5} → T9**.

---

## 6. Per-task checklist (AC → task map)

### static-analysis.md AC
- [ ] Node-native, npm-installed, offline (Behaviour.7/8) → **A1**
- [ ] `npm run analyze` scans client/server/scripts/e2e, prints file/line/rule/severity (Behaviour.1) → **A2**
- [ ] Exits non-zero at/above blocking severity, zero otherwise (Behaviour.2) → **A2/A5**
- [ ] Reuses/extends ESLint ignores; no noise from generated/media/data (Behaviour.3) → **A2**
- [ ] Security layer (security + type-aware tseslint + no-unsanitized on client) via committed config (Behaviour.4) → **A2**
- [ ] Repo-local invariant ruleset (portable-core, no-raw-SQL, thin routes, shell-out location), each with id+message+severity, crafted violation reported (Behaviour.5) → **A3**
- [ ] Inline suppression with rationale prevents gate failure (Behaviour.6) → **A3/A4**
- [ ] Clean run on introduction — all pre-existing findings fixed/suppressed (Behaviour.9) → **A4**
- [ ] `analyze` blocking gate step + CLAUDE.md runbook (Behaviour.2/10) → **A5**
- [ ] `typecheck`/`lint`/`test`/`build`/`test:e2e` still pass → **T9**

### test-coverage.md AC
- [ ] Unit-coverage command: vitest w/ coverage, text summary + machine report under gitignored dir (Behaviour.1) → **B1**
- [ ] e2e-coverage: Playwright collecting client (istanbul build) + server (`c8`) (Behaviour.2) → **B2/B3**
- [ ] Combined command merges unit + e2e into one report + printed total, common istanbul/lcov (Behaviour.3/6) → **B4**
- [ ] Includes client/src, server, scripts; excludes node_modules/dist/tests/e2e/migrations/config/.d.ts (Behaviour.4) → **B1** (shared exclude set reused by B2/B3/B4)
- [ ] All output under gitignored dir; `.gitignore` updated; nothing committed (Behaviour.5) → **B5**
- [ ] Fails below configured minimum, passes at/above; threshold committed + in gate (Behaviour.7) → **B4/B5**
- [ ] Plain `npm test`/`test:e2e` unchanged; e2e DB isolation unchanged (Behaviour.8) → **B2/B3** (verify), **T9**
- [ ] Baseline recorded; initial threshold at/just under it → gate green day one (Behaviour.9) → **B5**
- [ ] CLAUDE.md documents coverage commands/output/reading/threshold (Behaviour.10) → **B5**
- [ ] `typecheck`/`lint`/`test`/`build`/`test:e2e` still pass → **T9**

---

## 7. Learning-test list (one per AC / Behaviour scenario)

**Naturally unit-testable (write real tests):**
- Each custom invariant rule (A3): `@typescript-eslint/rule-tester` or ESLint `RuleTester` unit tests with
  valid + invalid fixtures — `no-raw-sql`, `thin-route-handlers`, `portable-core-no-node-builtins`,
  `shell-out-location`, `no-any-without-comment`. (Behaviour.5) → the strongest test surface in this milestone.
- `analyze` exit-code behaviour (A2/A5): a node/vitest test that runs ESLint programmatically (or spawns
  `npm run analyze`) against (a) a crafted **fixture dir** containing a known violation → expect **non-zero**,
  and (b) asserts the clean repo → **zero**. (Behaviour.2/9)
- Inline-suppression (A3/A4): fixture where an `eslint-disable` with rationale suppresses a rule → not reported. (Behaviour.6)

**Config/tooling — "test" = assert config/artifact/exit (not classic unit tests):**
- Unit coverage (B1): assert `npm run coverage:unit` writes `coverage/unit/coverage-final.json` + prints a total;
  assert exclude set (no `e2e/**`, `*.test.*`, migrations) present in the report. (Behaviour.1/4)
- e2e client (B2): assert `coverage/e2e-client/` json produced under the coverage script; assert a plain
  `npm run build` output is unchanged (no instrumentation) when `COVERAGE` unset. (Behaviour.2/8)
- e2e server (B3): assert `coverage/e2e-server/` json produced; assert `E2E_DATABASE_URL` isolation intact
  (the coverage web-server still binds the e2e DB) and plain `test:e2e` unaffected. (Behaviour.2/8)
- Combined + threshold (B4): assert `coverage` merges to `coverage/combined/` + prints total; a deliberately
  high threshold → **non-zero exit**, baseline threshold → **zero**. (Behaviour.3/6/7)
- gitignore (B5): assert `coverage/` matched by `.gitignore` (e.g. `git check-ignore coverage/` passes). (Behaviour.5)

**Not naturally testable (verify by review / manual):**
- CLAUDE.md runbook entries (A5, B5). (Behaviour.10)
- Baseline number recording in `docs/milestones.md` (B5). (Behaviour.9)
- ADRs / spec revisions (T0).
- Offline-ness (Behaviour.7) — asserted by design (all deps npm-installed), not a test.

---

## 8. Open items — `TODO: confirm with human`

Static analysis:
- **Q-A1 (rule surface, spec Q4):** confirm the first-pass invariant set = portable-core purity + no-raw-SQL +
  thin-route + shell-out-location, with `no-any-without-comment` advisory. Trim further, or add more?
- **Q-A2 (raw-SQL rule, spec wording):** confirm the rule allows the `drizzle-orm` `sql` tag (schema.ts defaults/checks)
  and the `server/lib/deploy-sql.ts` export tool, targeting only genuine raw-string execution. Exact target syntax?
- **Q-A3 (portable-core scope, spec Q3):** confirm restricted modules = `node:child_process`, `node:fs`
  (+ `node:stream`/`node:os`?) — NOT `node:path`/`node:url` (Worker-safe, used by portable services). Confirm the
  path scope (`server/app.ts` + `server/routes/**` only, OR also `server/services/**` + `server/lib/**`) and the
  full exempt list (`node-routes.ts`, `*-node.ts`, `claude-cli.ts`, `llm-provider-node.ts`, `node-media-store.ts`,
  `sqlite-path.ts`, `migrate.ts`). The spec's stated exempt list (`node-routes.ts` + `services/*-node.ts`) is
  **incomplete** if scope is widened beyond routes.
- **Q-A4 (shell-out allow-list, spec wording):** confirm the allow-list includes `server/lib/` (so
  `claude-cli.ts` is not flagged), not only `scripts/`+`server/services/`.
- **Q-A5 (blocking severity, spec Q5):** confirm error blocks / advisory rules `warn` (non-blocking), and how
  `analyze` treats warnings (report but don't fail).

Coverage:
- **Q-B1 (provider, spec Q3):** switch vitest to `@vitest/coverage-istanbul` (recommended, single common format)?
  If yes, keep or remove the now-unused `@vitest/coverage-v8`?
- **Q-B2 (merge tool):** `nyc` (bundles merge + `check-coverage` threshold) vs. a custom `istanbul-lib-coverage`
  merge script (zero extra runtime dep)?
- **Q-B3 (e2e server wrapping, spec Q6):** confirm the dedicated coverage web-server command (`c8` wrapping the
  tsx Node server, source-map aware) is acceptable, leaving plain `test:e2e` + `E2E_DATABASE_URL` untouched.
- **Q-B4 (e2e client collection):** confirm `vite-plugin-istanbul` gated by `COVERAGE=1` + a Playwright
  teardown/fixture reading `window.__coverage__`.
- **Q-B5 (threshold granularity, spec Q4):** per-metric (lines/branches/functions) on the **combined** figure
  only (recommended), or also per-suite? Initial numbers measured at implementation.

Shared:
- **Q-C1 (CI — corrects both specs' Open Q that "no CI exists"):** CI **does** exist (`.github/workflows/ci.yml`).
  Add `analyze` and `coverage` as `ci.yml` steps now, or keep them local-gate-only for this milestone?

---

## 8b. CONFIRMED DECISIONS (human, 2026-07-25) — these override the Open items above

All `TODO: confirm` items are now resolved. Developer phases MUST follow these:

- **Q-C1 → Add to CI now.** Wire `analyze` + combined `coverage` into `.github/workflows/ci.yml` this
  cycle. Requires the one-line Rule-4 revision to both specs' CI Open Q (T0). (chosen: "Add to CI now")
- **Q-B1 → Switch to `@vitest/coverage-istanbul`.** Replace `@vitest/coverage-v8` with the istanbul
  provider for one common merge format. Remove the now-unused `@vitest/coverage-v8` devDep.
- **Q-A1 → Full invariant set.** Implement all of: `portable-core-no-node-builtins`, `no-raw-sql`,
  `thin-route-handlers`, `shell-out-location` (all `error`), plus `no-any-without-comment` advisory (`warn`).
- **Q-B2 → `nyc`.** Merge istanbul/lcov reports and run the threshold check via `nyc` (merge + `check-coverage`).
- **Q-A5 (default taken) → `error` blocks, `warn` advisory-only.** `analyze` fails on any `error`-level
  finding; `warn`-level (advisory `no-any-without-comment`) is reported but does NOT fail the gate.
- **Q-A2 (default taken) → raw-SQL rule allows** the `drizzle-orm` `sql` tag (schema.ts) and
  `server/lib/deploy-sql.ts`; targets only genuine raw-string DB execution.
- **Q-A3 (default taken) → portable-core rule** restricts `node:child_process`, `node:fs`, `node:stream`
  (NOT `node:path`/`node:url`). Path scope + full verified exempt list per §2/§8 Q-A3 (includes
  `node-routes.ts`, `*-node.ts`, `claude-cli.ts`, `llm-provider-node.ts`, `node-media-store.ts`,
  `sqlite-path.ts`, `migrate.ts`).
- **Q-A4 (default taken) → shell-out allow-list** = `scripts/`, `server/services/`, `server/lib/`.
- **Q-B3 (default taken) → dedicated `c8`-wrapped coverage web-server**, leaving plain `test:e2e` +
  `E2E_DATABASE_URL` isolation untouched.
- **Q-B4 (default taken) → `vite-plugin-istanbul` gated by `COVERAGE=1`** + Playwright teardown/fixture
  reading `window.__coverage__`.
- **Q-B5 (default taken) → per-metric threshold on the COMBINED figure**, seeded at/just under the
  measured baseline. Exact numbers measured at implementation.

---

## 9. Context pack (Developer/reviewer phases read THIS, not fresh discovery)

### files — touch / create
- **create** `eslint.analysis.config.js` (root) — security + invariants pass (A2).
- **create** local rule plugin dir, e.g. `tools/eslint-plugin-invariants/` (index + one file per rule) + its
  `*.test.ts` RuleTester tests (A3).
- **edit** `eslint.config.js` (root) — only if base ignores need extracting for reuse; base style config stays.
- **edit** `package.json` (root) — add `analyze`, `coverage`, `coverage:unit`, `coverage:e2e` scripts + pinned
  devDeps (`eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `vite-plugin-istanbul`, `c8`,
  `@vitest/coverage-istanbul`, optional `nyc`); commit `package-lock.json`.
- **edit** `vitest.config.ts` (root) — add `coverage` block (provider, include/exclude, reporters, reportsDir) (B1).
- **edit** `client/vite.config.ts` — add `vite-plugin-istanbul` gated by `COVERAGE` env (B2).
- **edit** `playwright.config.ts` and/or a new coverage web-server script — c8-wrapped server + client-coverage
  collection, only under the coverage run (B3/B2).
- **create** `scripts/coverage/` — merge + threshold-check script (if custom, Q-B2) and/or an e2e-client
  `window.__coverage__` writer (B2/B4).
- **edit** `.gitignore` — add `coverage/`, `.nyc_output/` (B5).
- **edit** `CLAUDE.md` `## Commands` — analyze + coverage runbooks (A5, B5).
- **edit** `docs/milestones.md` — record coverage baseline; mark M18 progress (B5).
- **create** `docs/adr/0005-node-native-sast-eslint.md`, `docs/adr/0006-coverage-common-istanbul-format.md`;
  **edit** `docs/adr/README.md` index (T0).
- **edit** `docs/specs/static-analysis.md`, `docs/specs/test-coverage.md` — Rule 4 revision notes (CI exists;
  tightened rule wording) (T0).
- **optional edit** `.github/workflows/ci.yml` — add analyze/coverage steps (Q-C1).

### entrypoints (spec wires into)
- Portable core: `server/app.ts` (`createCoreApp`). Node entry: `server/index.ts`. Node-only routes:
  `server/routes/node-routes.ts` (`registerNodeRoutes`). Worker entry: `server/worker.ts`.
- Route handlers (thin-route rule targets): `server/routes/{health,questions,sessions,writing,speaking,app-vars,practice-routes}.ts`.
- e2e driver: `playwright.config.ts` `webServer` + `e2e/global-setup.ts` (DB isolation via `E2E_DATABASE_URL`).
- Client build: `client/vite.config.ts` (istanbul instrumentation).

### symbols / tables reused or referenced
- `createCoreApp()` (server/app.ts), `registerNodeRoutes(app)` (node-routes.ts), `AppVars` (routes/app-vars.ts).
- Portable services importing `node:path` (must NOT be flagged): `services/questions.ts`,
  `services/speaking.ts`, `services/export-import.ts`, `config/env.ts`.
- Node-only modules importing child_process/fs (exempt from portable-core rule): `lib/claude-cli.ts` (spawnSync),
  `lib/llm-provider-node.ts`, `runtime/node-media-store.ts`, `services/speaking-node.ts`, `db/sqlite-path.ts`,
  `db/migrate.ts`.
- Drizzle: `server/db/schema.ts` (`sql` tag legitimate), `server/db/factory.ts` (`createDb`, has one
  `no-explicit-any` disable), `server/db/index.ts`. Deploy tool: `server/lib/deploy-sql.ts` (raw SQL strings, legitimate).
- Shell-out wrappers: `scripts/lib/whisper.ts`, `scripts/lib/tesseract.ts`, `server/lib/claude-cli.ts`.
- `E2E_DATABASE_URL` (e2e/global-setup.ts) — must stay authoritative for e2e DB isolation.

### tests — existing locations
- vitest unit/render: `server/**/*.test.ts` (app, config/exam, lib/{bands,deploy-sql,envelope,export-import,nclc,
  random,claude-cli,llm-provider}, routes/{questions,practice-routes}, services/{speakingEvaluation,writingEvaluation},
  worker), `scripts/lib/*.test.ts`, `client/src/**/*.test.tsx` + `groupByBand.test.ts`.
- Playwright e2e: `e2e/features/*.spec.ts`, `e2e/api/api.spec.ts`; pages `e2e/pages/`, fixtures `e2e/fixtures/`.
- NEW rule tests colocate with the plugin (`tools/eslint-plugin-invariants/*.test.ts`) — picked up by the
  existing vitest include only if under a globbed path; may need adding a glob to `vitest.config.ts` include
  (e.g. `tools/**/*.test.ts`).

### constraints (CLAUDE.md invariants at stake)
- Portable core (`server/app.ts` + reachable) free of `node:child_process`/`node:fs` — the rule enforces the
  approximation; must not false-positive on Worker-safe `node:path`/`node:url`.
- Thin route handlers (logic in services only); no raw SQL (Drizzle only, `sql` tag allowed); migrations under
  `server/db/migrations/**` stay ignored/excluded.
- No Apple-Silicon/macOS logic outside `scripts/` + `server/services/` (+ `server/lib/` for claude-cli) — the
  shell-out rule codifies this.
- `{ data, error }` envelope, routes, schema, runtime behaviour: **unchanged** (both specs are tooling-only).
- Tooling must be **local-first, Node-native, offline, pinned**; plain `npm test`/`test:e2e`/`build` behaviour
  and e2e DB isolation must be **byte-for-byte unaffected** when coverage/analyze scripts are not invoked.
- Traceability: config/tooling files still carry a `// spec: docs/specs/<file>.md §…` comment on non-trivial
  logic (custom rules, merge script, coverage web-server wrapper).
