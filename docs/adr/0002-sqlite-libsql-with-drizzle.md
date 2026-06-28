# ADR 0002: SQLite (libSQL) via Drizzle, no database server

- Status: accepted
- Date: 2026-06-27

## Context

The app is a single-user, local-first study tool. It needs a relational store for
questions, sessions, and progress, but running it must not require standing up a database
server, Docker, or any cloud account. It also has to be portable across macOS and Windows,
and — later — able to run on Cloudflare's edge (see [ADR-0004](0004-single-cloudflare-worker-practice-only.md)).

## Decision

Use **SQLite (libSQL)** as the database, accessed exclusively through **Drizzle ORM**.

- The connection string is a libSQL `file:` URL read from `DATABASE_URL`
  (defaults to `file:./data/tcf_prep.db`); relative paths resolve against the repo root.
- `server/db/schema.ts` is the single source of truth. Schema changes require a generated
  Drizzle migration (`drizzle-kit generate`), committed alongside the schema.
- No raw SQL in application code — all access goes through Drizzle queries.

## Consequences

- Zero-setup local development: the DB is a single file created on first migrate; no
  server process to manage on either OS.
- The same SQLite baseline migration provisions Cloudflare **D1** at the edge, so local and
  online share one schema definition.
- SQLite's concurrency/scale ceiling is irrelevant for a single-user app; if the project
  ever needed multi-tenant scale, that would be a new decision (a superseding ADR).
- Drizzle + generated migrations add a small amount of ceremony per schema change, traded
  for type-safe queries and reviewable migration history.
