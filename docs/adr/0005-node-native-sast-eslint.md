# ADR 0005: Node-native static analysis by extending ESLint

- Status: accepted
- Date: 2026-07-25

## Context

The quality gate catches type errors (`typecheck`), style/hook issues (`lint`), and
behavioural regressions (`test` / `test:e2e`), but nothing performs a security-oriented
pass or enforces the **project invariants that span files** (portable-core purity,
Drizzle-only DB access, thin route handlers, platform-scoped shell-outs). Adding a SAST
step (Milestone 18, part a) raises a tooling question: the strongest off-the-shelf
scanners — Semgrep, CodeQL, njsscan — each pull in a non-JS toolchain (Python or Java)
and, in CodeQL's case, a hosted-analysis posture. That is at odds with the project's
local-first, npm-only, offline tooling stance.

## Decision

Build the static-analysis pass **Node-native, by extending ESLint** — the tool already
in the stack — rather than adopting a separate scanner. It runs under a dedicated
`eslint.analysis.config.js` (kept apart from the style `lint`) via `npm run analyze`, and
layers:

- **`eslint-plugin-security`** — Node.js SAST heuristics (unsafe `child_process`,
  non-literal `fs`/regex, `eval`-family).
- **type-aware `typescript-eslint`** (`recommendedTypeChecked` with the existing tsconfig
  projects) for correctness/safety rules the base recommended set omits.
- **`eslint-plugin-no-unsanitized`** on the client for DOM XSS sinks.
- a **repo-local invariant plugin** (portable-core purity, no-raw-SQL, thin route
  handlers, shell-out location, plus advisory `no-any-without-comment`), each rule with a
  stable id and an invariant-referencing message.

`analyze` fails the gate on any `error`-level finding; advisory rules run at `warn`.
Plugins are pinned via `package.json` + the lockfile so a scan is reproducible.

**Rejected alternatives:** Semgrep (Python runtime), CodeQL, and njsscan (Python) — all
rejected on the local-first / no-extra-toolchain constraint (no Python, no Java).

## Consequences

- No extra language runtime; the pass is offline, npm-installed, and reproducible.
- ESLint is largely **single-file** — cross-file taint tracking and true import-graph
  reachability are out of reach. The portable-core invariant is therefore enforced by a
  **path-scoped import restriction** (Worker-forbidden builtins in the portable set), an
  approximation of reachability, not the real thing.
- The security layer surfaces fresh findings the base `lint` never raised; these are
  triaged to a clean state (fixed or suppressed-with-rationale) at introduction so the
  blocking gate starts green.
- Invariants live as code (a versioned ruleset) rather than convention, and grow by
  adding rules to the local plugin rather than by adopting new tooling.
