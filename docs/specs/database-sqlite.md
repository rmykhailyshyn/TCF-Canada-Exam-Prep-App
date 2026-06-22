# Spec: Database Migration to SQLite

## Status
draft

## Goal
Move the application's persistence layer from PostgreSQL to SQLite, with **no change to any
observable application behaviour**. This is the foundation for hosting the app on Cloudflare's free
tier (where the database will be Cloudflare D1 — itself SQLite — sharing this same schema), while
also simplifying local development: SQLite is a single file with no Docker container, so the app and
its database now run on **Windows** as well as macOS. Because all data access already goes through
Drizzle ORM (no raw SQL anywhere), this migration is confined to the schema definition, the database
client, the Drizzle config, the generated migrations, and a handful of tooling scripts — the route
handlers, services, seed scripts, and import scripts are untouched at the logic level.

To avoid losing existing **local development data** (imported questions/tasks, recorded session
history, generated explanations/evaluations) when switching engines, this milestone also includes a
**one-time data-migration script** that copies every table from an existing PostgreSQL database into
the new SQLite database, preserving primary keys and foreign-key relationships. It is best-effort and
local-only — there is no production database — and once a developer has migrated their dev data the
script (and the `pg` dependency it needs) can be retired.

## Scope
- In scope:
  - Rewrite `server/db/schema.ts` from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`, preserving
    every table, column, constraint, index, and natural key.
  - Replace the `pg` / `drizzle-orm/node-postgres` client in `server/db/index.ts` with libSQL
    (`@libsql/client` + `drizzle-orm/libsql`), keeping the exported `db` symbol stable. Note: this
    milestone intentionally retains the module-singleton pattern; the singleton is replaced by an
    injected factory in Milestone 14 (`server-runtime.md`).
  - Switch `drizzle.config.ts` to `dialect: 'sqlite'` and a libSQL file URL.
  - Update the migration runner `server/db/migrate.ts` to the libSQL migrator.
  - Delete the existing PostgreSQL migrations and regenerate a single clean SQLite baseline (there is
    no production data to preserve — only local dev databases).
  - Update `server/config/env.ts` `DATABASE_URL` default + error text and `.env.example`.
  - Remove the Postgres Docker tooling: `db:up` / `db:down` scripts and `docker-compose.yml`.
  - Update dependencies in `server/package.json`: add `@libsql/client`; move `pg` / `@types/pg` from
    runtime dependencies to **devDependencies** (needed only by the one-time migration script), to be
    removed entirely in a later cleanup once dev data has been migrated.
  - Verify (and adjust only if required) the seed scripts and the CLI import scripts run on SQLite.
  - A **one-time data-migration script** (`npm run db:migrate-from-postgres`, e.g.
    `scripts/migrate-pg-to-sqlite.ts`) that reads every table from an existing PostgreSQL database
    (source URL via a flag/env such as `PG_DATABASE_URL`) and writes the rows into the SQLite database
    referenced by `DATABASE_URL`, **preserving primary-key ids** and inserting in **foreign-key
    dependency order**, with PG `boolean`/`timestamptz` values converted to the SQLite representations.
    Run against a freshly-migrated (schema-only) SQLite file; safe to re-run into an empty DB; prints a
    per-table row-count summary and a `--dry-run`. `pg` is kept as a **devDependency** solely for this
    script (it can be removed once dev data is migrated).
  - Documentation updates: CLAUDE.md Stack table / Commands / platform note, the four import specs'
    Goal lines, `quiz-session.md` revision note, `docs/milestones.md` (new Milestone 13),
    `docs/sdd-learnings.md`.
- Out of scope:
  - Any change to application behaviour, API contracts, or the data model's semantics (same tables,
    columns, constraints — only their dialect representation changes).
  - The Express → Hono server migration (Milestone 14).
  - Cloudflare D1 / R2 / Workers wiring (Milestones 15–16). This milestone only establishes that the
    schema and queries run on SQLite locally via libSQL; D1 reuses the same schema later.
  - Migrating a **production** Postgres instance (none exists). The data-migration script is a
    best-effort, one-time, local-dev convenience — not a supported production migration path, and not
    a reversible/repeatable sync.
  - Transforming or cleaning data during migration (rows are copied verbatim, only type representations
    are converted).

## Behaviour
Observable from a developer's perspective (there is no end-user-facing change):

1. With a fresh checkout and `DATABASE_URL=file:./data/tcf_prep.db` (the new default), `npm run
   db:migrate` creates the SQLite database file and all tables, with **no PostgreSQL server or Docker
   container running**.
2. `npm run db:generate` produces SQLite-dialect migration SQL under `server/db/migrations/`.
3. `npm run dev` starts the server against the SQLite file; all four sections (reading, listening,
   writing, speaking) behave exactly as before.
4. `npm run seed:dev` and `npm run seed:listening-dev` populate the SQLite database and the seeded
   content is playable in the UI, unchanged.
5. The unit/render test suite (`npm test`) and the end-to-end suite (`npm run test:e2e`) pass against
   SQLite.
6. Timestamp columns continue to round-trip as JavaScript `Date` values in service code (via Drizzle
   `integer` timestamp mode), so `created_at` / `startedAt` / `completedAt` / `answeredAt` /
   `submittedAt` / `generatedAt` semantics are preserved.
7. Boolean columns (`options.is_correct`, `question_results.is_correct`) continue to read/write as
   JavaScript booleans (via Drizzle `integer` boolean mode).
8. `db:up` and `db:down` no longer exist; attempting to start a Postgres container is no longer part
   of any workflow. The app runs on both macOS and Windows with no platform-specific DB setup.
9. A developer with existing data in PostgreSQL can run `npm run db:migrate` (schema) followed by
   `npm run db:migrate-from-postgres -- --from <PG_DATABASE_URL>` to copy all of their data into the
   SQLite database. After it completes, every row from every table is present in SQLite with the same
   primary-key ids and intact foreign-key links, and the app shows the same questions, session
   history, explanations, and evaluations as before. Re-running into an already-migrated DB is not
   required, and `--dry-run` reports the row counts it would copy without writing.

## Data model changes
No semantic change. The same 14 tables, columns, natural keys, CHECK constraints, and indexes are
preserved; only their Drizzle/SQLite representation changes. The type mapping applied uniformly:

| PostgreSQL (current) | SQLite (`sqlite-core`) |
|---|---|
| `serial('id').primaryKey()` | `integer('id').primaryKey({ autoIncrement: true })` |
| `integer(...)` | `integer(...)` (unchanged) |
| `text(...)` | `text(...)` (unchanged) |
| `boolean(...)` | `integer(..., { mode: 'boolean' })` |
| `timestamp(..., { withTimezone: true }).notNull().defaultNow()` | `integer(..., { mode: 'timestamp' }).notNull().default(sql\`(unixepoch())\`)` |
| `timestamp(..., { withTimezone: true })` (nullable) | `integer(..., { mode: 'timestamp' })` |
| `check(name, sql\`...\`)` | `check(name, sql\`...\`)` (unchanged — sqlite-core supports it) |
| `unique(name).on(...)` | `unique(name).on(...)` (unchanged) |
| `index(name).on(...)` | `index(name).on(...)` (unchanged) |
| `.references(() => t.id)` | `.references(() => t.id)` (unchanged) |

Notes:
- The `between 1 and 3` and `in ('A','B',...)` CHECK expressions are standard SQL and valid in SQLite.
- SQLite enforces foreign keys only when `PRAGMA foreign_keys = ON`. The libSQL client is configured
  to enable it so the existing `references(...)` constraints remain enforced (matching Postgres).
- `timestamp` mode `'timestamp'` stores seconds as INTEGER and maps to/from `Date` in Drizzle; this
  preserves the `Date` type seen by all existing service code. (`unixepoch()` is the SQLite default
  for "now".)

## API contract
None — no API changes. The JSON envelope and all endpoints are unchanged.

## Acceptance criteria
- [ ] `server/db/schema.ts` imports only from `drizzle-orm/sqlite-core`; no `pg-core` import remains, and every table/column/constraint/index from the previous schema is present. (Data model changes)
- [ ] `server/db/index.ts` constructs the Drizzle client via `@libsql/client` + `drizzle-orm/libsql`, exports the same `db` symbol, and enables foreign-key enforcement. (Behaviour.1, Data model notes)
- [ ] `drizzle.config.ts` has `dialect: 'sqlite'` and reads the libSQL file URL from `DATABASE_URL`. (Behaviour.2)
- [ ] The old PostgreSQL migration files are removed and `npm run db:generate` produces a single SQLite baseline migration; `npm run db:migrate` applies it to a fresh `file:` database with no Postgres/Docker running. (Behaviour.1, 2)
- [ ] `server/config/env.ts` default `DATABASE_URL` is a `file:` URL and `.env.example` matches. (Behaviour.1)
- [ ] `db:up` / `db:down` scripts and `docker-compose.yml` are removed; `@libsql/client` is added and `pg` / `@types/pg` are moved to devDependencies (retained only for the migration script). (Behaviour.8)
- [ ] `npm run db:migrate-from-postgres -- --from <PG_DATABASE_URL>` copies every table from a populated Postgres DB into a schema-only SQLite DB, preserving primary-key ids and all foreign-key references, and prints a per-table row-count summary; `--dry-run` reports counts without writing. (Behaviour.9)
- [ ] After migrating a real dev database, row counts match per table and the app shows the same questions, session history, explanations, and evaluations as the Postgres source (spot-checked end to end). (Behaviour.9)
- [ ] `npm run seed:dev` and `npm run seed:listening-dev` populate SQLite and the content is playable. (Behaviour.4)
- [ ] `npm test` passes against SQLite. (Behaviour.5)
- [ ] `npm run test:e2e` passes against SQLite. (Behaviour.5)
- [ ] A manual `npm run dev` smoke test of one reading and one listening session shows identical behaviour to the Postgres version, with timestamps and correctness booleans intact. (Behaviour.3, 6, 7)
- [ ] The app + DB run on Windows with no Docker (no Postgres container). (Behaviour.8)

## Open questions
- **Timestamp representation: `integer` (unix seconds) vs `text` (ISO 8601).** Chosen: `integer`
  timestamp mode, because it maps to/from JS `Date` in Drizzle with no service-code change and is the
  most portable to D1. Risk: any code that compared/sorted timestamps as strings would break — to be
  confirmed none does during implementation (a Rule 4 check). Sub-second precision is lost (seconds
  granularity); acceptable for this app's history/ordering needs.
- **libSQL vs better-sqlite3 for the local driver.** Chosen: libSQL, because its **async** API matches
  Cloudflare D1's, so the Drizzle call sites stay identical between local and cloud (Milestone 15),
  and it avoids native-build friction on Windows. better-sqlite3 (synchronous) would also work locally
  but would diverge from the D1 code path.
- **Does `drizzle-kit generate` for SQLite reproduce every CHECK/partial constraint faithfully?** To be
  verified against the generated baseline during implementation; if a constraint does not round-trip,
  the schema definition is the source of truth and the spec/migration is corrected (Rule 4).
- **Migration script — preserving ids and insertion order.** SQLite accepts explicit values into an
  `INTEGER PRIMARY KEY AUTOINCREMENT` column, so the script inserts rows with their original ids and
  copies tables in foreign-key dependency order (passages → questions → options/audio_files/
  transcript_segments/explanations; writing_tasks/speaking_tasks → sessions → question_results/
  writing_responses/speaking_responses → *_evaluations). Open: whether to disable FK enforcement during
  the copy and re-verify at the end (simpler) or strictly order every insert; and whether to reset the
  SQLite autoincrement high-water mark after a preserved-id copy so new inserts don't collide. To be
  settled during implementation; both are local-only correctness details with no behavioural impact.
- **How does the migration script read Postgres without the app's pg client?** It opens its own `pg`
  connection to `--from`/`PG_DATABASE_URL` and reads with plain `SELECT *` per table (no Drizzle pg
  dialect needed), writing through the new SQLite Drizzle `db`. This is the sole remaining use of `pg`,
  hence its demotion to a devDependency.

## Revision history
- 2026-06-20: Initial draft (Milestone 13). Part of the Cloudflare-hosting initiative (PostgreSQL →
  SQLite → D1). Pairs with the forthcoming `server-runtime.md` (M14), `cloud-deployment.md` (M15), and
  `content-deploy.md` (M16) specs.
- 2026-06-21: Added a one-time PostgreSQL → SQLite **data-migration script**
  (`npm run db:migrate-from-postgres`) to the scope so existing local dev data (questions, session
  history, explanations, evaluations) is preserved across the engine switch, not just the schema.
  Moved `pg`/`@types/pg` from "drop" to "devDependency (kept for the script)"; reframed the
  out-of-scope item from "data migration (none exists)" to "production migration only". Added
  Behaviour.9, two acceptance criteria, and two open questions (id/order preservation; reading PG
  without the app client).
