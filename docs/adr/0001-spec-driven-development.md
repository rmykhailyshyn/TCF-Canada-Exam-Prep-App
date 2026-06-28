# ADR 0001: Spec-driven development

- Status: accepted
- Date: 2026-06-27

## Context

This project is, in part, a testbed for evaluating Spec-Driven Development (SDD) as a
methodology — not only a study app. A solo developer working with an AI coding assistant
needs a way to keep intent explicit and prevent the implementation from quietly drifting
away from what was actually wanted. Without a written contract, an assistant tends to
optimise locally and the "why" is lost.

## Decision

Every feature begins with a written spec in `docs/specs/` using the fixed template in
`CLAUDE.md`. Code follows the spec, not the other way around. Specifically:

- No implementation file is created or modified for a new feature without a corresponding
  spec; if none exists, the spec is written first and approved before coding.
- A spec moves from `draft` to `approved` only by explicit human confirmation.
- If implementation reveals the spec was wrong, the **spec** is updated first (divergence
  is a spec defect, not a code defect).
- Non-trivial functions carry a traceability comment: `// spec: docs/specs/<file>.md §Behaviour.N`.

Observations about whether SDD actually improves output quality are logged separately in
`docs/sdd-learnings.md`.

## Consequences

- Intent is explicit and reviewable before code exists; rework from misunderstanding drops.
- An approval gate adds friction on small changes — accepted as the cost of clear signal.
- Specs and traceability comments must be kept in sync with the code, or they become
  misleading. This is enforced by the invariants in `CLAUDE.md`.
- The methodology is itself under evaluation; this ADR may be revised if SDD proves a net
  negative for a solo + AI workflow.
