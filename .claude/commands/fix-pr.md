---
description: Apply a pointed fix pass to an existing PR — edit directly, pin behaviour changes with a test, run only touched tests, then the full gate once. The lightweight counterpart to build-story, for follow-up work on a green PR, not a Day-1 spec.
argument-hint: <PR number | URL | list of things to fix>
---

Apply a pointed fix pass to a PR for: $ARGUMENTS

The light path for follow-up work on an existing PR — reviewer comments, your own list, or a
described fix. Unlike `/build-story` (architect → test-author → implementer → release-agent → gate,
which fans out because a new spec re-reads the repo from nothing), the context here is already held
and the change is scoped, so edit directly and skip the subagent chain.

## Argument
- **PR number/URL** → fetch its review comments (Step 0).
- **A list of fixes** (pasted comments, your bullets, or a described change) → work from it; still
  resolve the PR number for CI and replies.
- **Nothing** → the PR for the current branch (`gh pr view --json number,url`).

## Proportionality (the one rule that matters)
Match effort to scope **per fix**, not per pass. Default: **edit directly** with the Edit tool. Only a
fix that changes an **API contract / data model**, ripples **across the route/service/schema layers**,
or needs a **new/updated ADR** (`docs/adr/`) may go to the `implementer` subagent — and only
consciously, with a one-line justification. Depth alone is not a reason to fan out. When in doubt, direct.

## Loop (once through, no background release-agent)
0. **Gather.** `gh pr view <arg> --json number,url,headRefName,state,statusCheckRollup`; be on the PR's
   branch (never fix on `main`). If the fixes weren't given inline, fetch them (`gh pr view <n> --comments`,
   and `gh api .../pulls/<n>/comments` for inline threads). List each fix and mark it pointed or wide.
1. **Fix directly.** Edit the files. Follow the repo's durable rules (CLAUDE.md — thin handlers,
   services-only logic, `{ data, error }` envelope, Drizzle-only + migration on schema change, portable
   core free of `node:*`, `// spec:` comments) from memory — don't re-derive them here. Never weaken a
   test to make it pass; surface a wrong test.
2. **Pin behaviour changes with a test.** A behavioural fix → a vitest/Playwright test asserting the new
   behaviour (default). Purely local/cosmetic/doc fixes don't need one — use judgement. If the fix
   changes what the spec described, update the spec too (Rule 4: a spec gap is a spec defect).
3. **Test.** Run only the touched spec(s) once (`npm test -- <path>`, or `npm run test:e2e` for e2e) —
   never the full suite in step 3, never in the background. If a fix looks like it ripples widely, ask first.
4. **Gate.** Run the full gate once, after fixes are green: `npm run lint && npm run typecheck && npm test
   && npm run build` (add `npm run test:e2e` if the change touches a user-facing flow). Don't weaken it to
   reach green.
5. **Commit + push.** One fix-up commit (`fix: address review — <what>`), directly — no release-agent.
   Include any ADR/spec edit in the same commit. End the commit message with the Claude Code
   `Co-Authored-By` line. Never force-push. Only commit when the fix pass is what I asked for.
6. **Verify CI** via `gh pr checks <n>` directly (no background watcher); report status.
7. **Reply to reviewers** on the specific thread — what changed, which test pins it, the SHA.

## Bounds (from CLAUDE.md)
Never merge (human merges). The gate is blocking — don't weaken it. Touched tests only in step 3; full
gate once. If it's actually a new feature, it needs a spec first — use `/build-story`. To *find* issues
(not fix them), use `/code-review` on the working diff or `/review` on the PR.
