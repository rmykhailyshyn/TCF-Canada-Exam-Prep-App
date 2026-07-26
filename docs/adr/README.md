# Architecture Decision Records

This directory records the **significant, hard-to-reverse decisions** behind the project
— the "why" that the code and `CLAUDE.md` assume but don't fully explain. It complements
the spec log (`docs/specs/`, the "what") and the methodology log
(`docs/sdd-learnings.md`, observations about SDD itself).

## When to add an ADR

Add one when a decision is architectural and durable: a stack choice, a cross-cutting
constraint, a deployment model, or a methodology rule. Day-to-day feature behaviour
belongs in a spec, not an ADR.

## Format

Each record is `NNNN-short-title.md` using:

- **Status** — proposed | accepted | superseded by [ADR-XXXX] | deprecated
- **Context** — the forces and constraints in play
- **Decision** — what we chose
- **Consequences** — the trade-offs we accept as a result

Records are immutable once accepted: to change a decision, add a new ADR that supersedes
the old one (and update the old one's status), rather than editing history.

## Index

| ADR | Title | Status |
| --- | ----- | ------ |
| [0001](0001-spec-driven-development.md) | Spec-driven development | accepted |
| [0002](0002-sqlite-libsql-with-drizzle.md) | SQLite (libSQL) via Drizzle, no database server | accepted |
| [0003](0003-local-cli-tooling-over-cloud-apis.md) | Local CLI tooling (Whisper / Tesseract / Claude CLI) over cloud APIs | accepted |
| [0004](0004-single-cloudflare-worker-practice-only.md) | Single Cloudflare Worker, practice-only online | accepted |
| [0005](0005-node-native-sast-eslint.md) | Node-native static analysis by extending ESLint | accepted |
| [0006](0006-coverage-common-istanbul-format.md) | Test coverage via a common istanbul format, merged locally | accepted |
