# Spec: Static Code Analysis (SAST)

## Status

approved

> Milestone 18, part (a). Adds a free, local, **Node-native** static-analysis pass to the repo and the
> quality gate. Developer-facing tooling only — like `lint` / `typecheck`, it changes no application
> behaviour, no data model, and no runtime code path. Extends the existing ESLint layer (style / type /
> React-hooks) with a distinct **security + project-invariant** analysis pass that reasons about
> insecure API usage and repo-specific invariants ESLint's default recommended rules do not cover.

## Goal

The project's quality gate today catches type errors (`typecheck`), style/hook issues (`lint`), and
behavioural regressions (`test` / `test:e2e`), but nothing performs a security-oriented pass or enforces
the **project invariants that span files** (portable-core purity, Drizzle-only DB access, thin route
handlers, platform-scoped shell-outs). This spec adds a free, local-first, **Node-native** static-
analysis command so that a defined class of defects and invariant-violations is surfaced automatically
and **fails the quality gate**. It must run **offline** with no paid SaaS, no cloud dependency, and — per
the approved tool decision — **no non-JS toolchain** (no Python/Java), consistent with the project's
local-first, npm-based tooling. The output is a developer-runnable command plus a committed, version-
controlled ruleset. Pre-existing findings are triaged to a clean (or explicitly baselined) state at
introduction so the blocking gate starts green.

## Scope

- In scope:
  - A **Node-native** (npm-installed, no Python/Java) static-analysis pass, built by extending ESLint —
    the tool already in the stack — with a dedicated **security + invariants** configuration run
    separately from the existing style `lint`:
    - `eslint-plugin-security` (Node.js-oriented SAST heuristics: unsafe `child_process`, non-literal
      `fs`/regex, `eval`-family, etc.),
    - the type-aware `typescript-eslint` rules relevant to correctness/safety (leveraging the existing
      `tsconfig` project setup),
    - `eslint-plugin-no-unsanitized` for the client (DOM XSS sinks), where applicable.
  - A committed repo-local **project-invariant ruleset**, expressed with flat-config
    `no-restricted-imports` / `no-restricted-syntax` (path-scoped) and, where a pattern rule cannot
    express it, a small local ESLint rule plugin. Invariants drawn from CLAUDE.md — at minimum:
    - no `node:*` (esp. `node:child_process` / `node:fs`) import in the **portable core** — approximated
      as a path-scoped restriction on `server/app.ts` + `server/routes/**` **except** the Node-only
      `server/routes/node-routes.ts` and `server/services/*-node.ts` (see Open questions on the
      approximation), so the Worker bundle stays clean;
    - no raw SQL string / template outside Drizzle query builders (DB access goes through Drizzle);
    - route handlers stay thin (no direct DB / `child_process` calls in `server/routes/**` — go through a
      service);
    - no `any` without an accompanying explanation comment (advisory / warn-level);
    - no Apple-Silicon/macOS-specific logic (`child_process`, whisper/tesseract shell-outs) outside
      `scripts/` and `server/services/`.
  - A dedicated config (e.g. `eslint.analysis.config.js`) and an npm script (`npm run analyze`, working
    name) that runs this stricter pass over the repo and **exits non-zero on any finding at or above the
    configured blocking severity**.
  - Adding `analyze` to the documented quality gate (blocking), alongside `typecheck` / `lint` / `test`.
  - A documented triage path for existing findings: fix, or suppress at the site with an ESLint disable
    comment carrying a rationale.
  - A short runbook entry in CLAUDE.md `## Commands` (how to run, how to read/triage/extend findings).
- Out of scope:
  - Reconfiguring or replacing the existing style `lint` (this is an **additional** pass; the current
    `eslint .` stays the style/hooks/type layer).
  - Any change to application behaviour, routes, schema, or the JSON envelope.
  - Non-JS SAST tools (Semgrep/Python, CodeQL, njsscan) and any paid/cloud findings backend — explicitly
    excluded by the Node-native decision.
  - Auto-fixing findings (the pass reports; humans fix — a follow-up may add opt-in `--fix`).
  - Dependency/vulnerability scanning of `node_modules` (SCA) — a separate concern, not this spec.
  - Test-coverage measurement (Milestone 18 part (b); see `test-coverage.md`).

## Behaviour

_Written from the developer's perspective — this is a developer-facing tool, so "the user" is the
developer running the repo's tooling._

1. Running the analysis command (`npm run analyze`) statically scans the project source
   (`client/`, `server/`, `scripts/`, `e2e/`) with ESLint under the dedicated security+invariants
   config and prints a human-readable list of findings (file, line, rule id, message, severity).
2. The command **exits non-zero** when any finding at or above the configured blocking severity
   (error) is present, and **zero** when there are none — so it is a usable gate step.
3. The scan respects the repo's existing ESLint ignores (`dist/`, `node_modules/`, `.venv*/`,
   `server/db/migrations/**`, `client/vite.config.ts`) plus any additional generated/media/data paths,
   so generated/third-party files never produce noise.
4. The security layer flags Node-oriented insecure patterns (`eslint-plugin-security`) and, on the
   client, unsanitized DOM sinks (`eslint-plugin-no-unsanitized`); the exact rule set is pinned in the
   committed config.
5. The repo-local invariant ruleset enforces the invariants listed in Scope. Each custom rule has a
   stable id, a message pointing at the invariant it protects, and a severity. Introducing a violation
   (e.g. a `node:child_process` import inside the portable core, or a raw SQL string outside Drizzle) is
   reported by the corresponding rule.
6. A finding can be **suppressed at its site** with an ESLint disable comment that includes a short
   rationale; suppressed findings do not fail the command.
7. The whole scan runs **fully offline** and uses **only npm-installed, JS/TS tooling** — no Python,
   Java, or other runtime — and completes fast enough to run locally on demand and in the gate.
8. The tool and plugin versions are **pinned** via `package.json` + the lockfile, so a scan is
   reproducible and not silently changed by upstream rule updates.
9. On first introduction, the existing repo is scanned and every pre-existing finding is triaged: fixed,
   or explicitly suppressed with a rationale — so a **clean** run is the starting state and the blocking
   gate is green on day one.
10. `npm run analyze` is part of the documented quality gate; the runbook documents how to run the scan,
    interpret findings, add a project invariant rule, and suppress a false positive.

## Data model changes

None. Tooling only.

## API contract

None. No runtime routes or endpoints are added or changed.

## Acceptance criteria

Testable pass/fail conditions. Each maps back to a behaviour above.

- [ ] The analysis pass is Node-native — npm-installed ESLint + plugins, no Python/Java/other runtime — and runs offline. (Behaviour.7, Behaviour.8; Open Q1 resolved)
- [ ] `npm run analyze` (or the agreed script name) runs the security+invariants ESLint config over `client/`, `server/`, `scripts/`, `e2e/` and prints findings with file/line/rule/severity. (Behaviour.1)
- [ ] The command exits non-zero when a finding at/above the blocking severity exists and zero otherwise. (Behaviour.2)
- [ ] The scan reuses/extends the repo's ESLint ignores so generated/third-party/media/data paths produce no findings. (Behaviour.3)
- [ ] The security layer (`eslint-plugin-security`, type-aware `typescript-eslint`, `eslint-plugin-no-unsanitized` on the client) is enabled via committed config. (Behaviour.4)
- [ ] A committed repo-local invariant ruleset enforces at least: no `node:*` reachable from the portable core; no raw SQL outside Drizzle; no direct DB/`child_process` in route handlers; no OCR/Whisper shell-outs outside `scripts/`+`server/services/`. Each rule has an id, invariant-referencing message, and severity, and a crafted violation is reported. (Behaviour.5)
- [ ] A finding can be suppressed inline with a rationale, and suppression prevents a gate failure for that site. (Behaviour.6)
- [ ] Introducing the pass leaves a **clean** run: every pre-existing finding is fixed or suppressed with rationale, so the blocking gate is green. (Behaviour.9)
- [ ] `npm run analyze` is a blocking step of the documented quality gate, and CLAUDE.md `## Commands` documents how to run, read, triage, and extend it. (Behaviour.2, Behaviour.10)
- [ ] The existing `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` still pass. (all)

## Open questions

1. ~~**Tool choice.**~~ **Resolved 2026-07-25:** Node-native only (no Python/Java). Build the pass by
   extending **ESLint** (already in the stack) with `eslint-plugin-security`, type-aware
   `typescript-eslint`, `eslint-plugin-no-unsanitized`, and a repo-local invariant ruleset, run under a
   dedicated `eslint.analysis.config.js` via `npm run analyze`. Semgrep (Python) and CodeQL are
   rejected on the local-first / no-extra-toolchain constraint. Accepted trade-off: ESLint is largely
   single-file, so cross-file taint analysis is out of reach — the portable-core invariant is enforced
   by a **path-scoped import restriction** (see Q3), not true reachability.
2. ~~**Gate integration now, or report-only first?**~~ **Resolved 2026-07-25:** `analyze` is a
   **blocking** gate step from the outset. Pre-existing findings are triaged to a clean/baselined state
   at introduction (Behaviour.9) so the gate starts green — no report-only phase.
3. **Portable-core detection.** Confirm the path-scoped approximation is acceptable: flag `node:*`
   imports in `server/app.ts` + `server/routes/**` **except** `server/routes/node-routes.ts` and
   `server/services/*-node.ts` (and any other explicitly Node-only module). A true import-graph
   reachability analysis is out of scope for an ESLint-based pass. Are the exact exempt paths correct
   and complete against the current portable-core boundary?
4. **Custom-rule surface.** Is the invariant list in Scope the right starting set, or trim to the
   highest-value few (portable-core purity + no-raw-SQL) for the first pass and grow later?
5. **Blocking severity.** Confirm only `error`-level findings block, with the advisory
   `any`-without-comment rule (and similar low-signal rules) at `warn` (non-blocking).
6. **Where else does it run?** Local gate is confirmed; also wire a pre-push hook and/or CI? No CI
   workflow currently exists in the repo — introducing one is a separate decision.

## Revision history

- 2026-07-25: Initial draft (Milestone 18, part a).
- 2026-07-25: Resolved Open Q1 (Node-native ESLint-based pass; Semgrep/CodeQL rejected) and Q2 (blocking
  gate from the outset, no report-only phase) per the human's decisions; Goal/Scope/Behaviour/AC updated
  accordingly. Status draft → approved.
