<!--
This project follows Spec-Driven Development (see CLAUDE.md). Code follows the spec,
not the other way around. Fill in each section; delete the HTML comments.
-->

## Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Linked spec

<!--
Per CLAUDE.md Rule 1, feature work has a spec in docs/specs/. Link it and note its
status (draft | approved | implemented | revised). For a pure chore/fix with no spec,
write "N/A — <reason>".
-->

- Spec: `docs/specs/____.md`
- Spec status after this PR: <!-- e.g. implemented -->

## Behaviour / acceptance criteria covered

<!-- Which numbered behaviours / acceptance-criteria items does this satisfy? -->

-

## How it was tested

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:e2e` (if UI/flow affected)
- [ ] Manual check (describe):

## Checklist

- [ ] Spec written/updated **first** and approved (no code ahead of an approved spec)
- [ ] Spec `Status` updated, and a revision logged if the spec changed
- [ ] Traceability comments added (`// spec: docs/specs/<file>.md §Behaviour.N`)
- [ ] Business logic lives in `services/`, not route handlers
- [ ] Schema changes have a committed Drizzle migration
- [ ] No new Apple-Silicon/macOS assumptions outside `scripts/` and `server/services/`
