---
description: Run the implementation cycle end-to-end for one spec (docs/specs/) — plan, test-first, implement, gate, review — up to a merge-ready PR (human merges).
argument-hint: <path-to-spec-file under docs/specs/>
---

Run the implementation cycle for the spec at: $ARGUMENTS

Drive the loop. This is Spec-Driven Development (CLAUDE.md): the spec is the source of truth. Stop and hand back to the human at the merge gate — never merge.

**Precondition — the approval gate (CLAUDE.md Rule 3).** The spec's `Status` must be `approved` before any code is written. If it is `draft`, stop after step 2 and ask me to approve it. Only I move a spec `draft` → `approved`.

1. **Plan (Architect).** Use the `planner` subagent to produce the task graph, per-task checklist (from the spec's Acceptance criteria), learning-test list, and the **context pack** (files to touch, entrypoints `server/routes/*`/`server/services/*`/`client/`, key symbols/Drizzle tables, existing test locations, CLAUDE.md invariants at stake). Reconcile against existing repo modules first.
2. **Validate the plan.** Use the `domain-analyst` subagent to confirm every Acceptance-criteria item maps to a task and no CLAUDE.md/ADR/spec invariant is violated. Report `TODO: confirm` items to me before proceeding. If the spec is still `draft`, pause here for my approval.
3. **Author tests (Developer).** Use the `test-author` subagent to write red vitest unit + Playwright e2e tests before any implementation, working from the plan's context pack rather than re-discovering the repo. Confirm they fail for the right reason (`npm test -- <path>`, `npm run test:e2e`).
4. **Implement (Developer).** You (the orchestrator) own **one shared task branch** (never `main`); every task's invocation works in it so the diff accumulates. Loop over the plan's task graph in dependency order, invoking the `implementer` subagent **once per task, each a fresh context** — never pass the previous invocation's transcript. Each invocation gets only a COMPACT handoff: the single task's spec slice + its red tests, the shared branch, the modules the plan said to reuse, and a one-line summary of what previous tasks changed. After each task, confirm **that task's own tests** are green locally before spawning the next (a task with no dedicated test gates on `npm run typecheck` + lint + no regression); run the full gate **once, after the last task**. Honour the CLAUDE.md invariants (thin handlers, services-only logic, `{ data, error }` envelope, Drizzle-only + migration, portable core free of `node:*`, `// spec:` comments). If a task hits its iteration cap without going green, **halt the loop** and route its compact result back to `test-author`/me. Never edit a test to pass.
5. **Open PR (Developer).** Use the `release-agent` subagent to commit and open the PR referencing the spec path, with the AC-coverage checklist and learning-test list. Set the spec's `Status` to `implemented`.
6. **Gate (CI).** Ensure `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (Playwright), and `npm audit` are green. On red, route back to `implementer`.
7. **Review — parallel.** On green CI, spawn `domain-analyst`, `security-reviewer`, and `reviewer` concurrently in a single turn — three independent read-only passes over the same committed diff, not a sequential chain. Wait for all three, then aggregate findings into one merge recommendation; route any blocking finding back to `implementer` as a single consolidated fix pass.
8. **Stop.** Present the recommendation, the AC-coverage checklist, and CI status to me for the human merge gate. Confirm the spec `Status` is `implemented` and note any `docs/sdd-learnings.md` observation worth recording.
