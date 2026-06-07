# SDD Learnings

Observations about the Spec-Driven Development process as it applies to this project.
Add entries as the project progresses.

---

## Key questions under evaluation

- Does writing specs before code reduce rework?
- Does the spec approval gate cause friction, or does it prevent bad decisions?
- Are spec traceability comments useful during debugging, or just noise?
- How well does this workflow scale to a solo dev vs. a small team?

---

## Log

### 2026-06-04 — Project kickoff

Specs drafted for all seven milestones before any implementation code was written.
The spec-writing process surfaced several ambiguities early (quiz modes, LLM provider
flexibility, import file structure, timing configuration) that would otherwise have
become code-level assumptions.

Notable: the interview-style clarification loop (asking questions before writing specs)
felt natural and forced precision on things like "what does session mean?" and
"one PNG per question or per passage?" These are exactly the kinds of decisions
that tend to get hardcoded silently without a spec step.

Open question: will the approval gate feel like useful friction or a bottleneck on a
solo project where the developer and the approver are the same person?
