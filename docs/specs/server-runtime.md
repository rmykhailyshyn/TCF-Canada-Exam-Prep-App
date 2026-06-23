# Spec: Portable Server Runtime (Express → Hono)

## Status
approved

## Goal
Make the backend run unchanged on two runtimes — **Node.js locally** (full feature set) and a
**Cloudflare Worker** in the cloud (Milestone 15) — from a single codebase, with no change to any API
contract or observable behaviour locally. The current server is Express on Node, which cannot run on
Cloudflare Workers. This milestone replaces Express with **Hono** (a runtime-agnostic web framework
that runs on both Node, via `@hono/node-server`, and Workers natively), keeping the framework-agnostic
service layer untouched, and introduces three small abstractions — a **database factory**, a
**`MediaStore` interface**, and a **capabilities flag** — that let the same route code bind to Node
resources (libSQL file, local filesystem) or Worker resources (D1, R2) later. The CLI-backed features
that cannot run on Workers (imports, enrichment, AI scoring, transcription, correction) are factored so
they live only in the Node entry and never enter the Worker bundle.

## Scope
- In scope:
  - Replace Express with Hono across `server/index.ts` and the five route modules in `server/routes/`,
    translating `express.Router()` handlers to Hono routers. Services in `server/services/` are
    unchanged.
  - Keep the JSON envelope (`server/lib/envelope.ts`) and all endpoint paths, request/response shapes,
    and error codes identical.
  - Replace `multer` (speaking audio upload) with Hono's built-in `formData`/`parseBody`.
  - Introduce a **DB factory** so the Drizzle instance is constructed from the runtime's binding
    (libSQL on Node; D1 on Workers — Milestone 15) rather than imported as a module singleton.
    Note: Milestone 13 (`database-sqlite.md`) deliberately keeps the singleton to scope its own
    change; this milestone removes it and switches all services to receive the DB via the factory.
  - Introduce a **`MediaStore` interface** (range read, put, exists) with a Node/filesystem
    implementation, replacing direct `fs` access in the audio / passage-image / speaking-recording
    routes. The R2 implementation lands in Milestone 15.
  - Introduce a **capabilities flag**: `GET /api/health` returns
    `{ status, capabilities: { aiScoring, transcription, imports } }`. On Node all are `true`.
  - Structure the Hono app as a **portable core** (mountable on both runtimes) plus a **Node-only
    extension** that registers the CLI-backed routes, so `node:child_process` / `node:fs` modules are
    not reachable from the (future) Worker entry.
  - Keep the local dev experience identical: `npm run dev` still runs Vite + the Node server; the Vite
    `/api` proxy and the e2e harness are unchanged.
  - **Remove all remaining PostgreSQL code and files.** Milestone 13 deliberately kept `pg`/`@types/pg`
    (as devDependencies) and the one-time `db:migrate-from-postgres` script so developers could carry
    their data across. This milestone assumes that migration has happened (it runs right after M13) and
    deletes the leftovers: the `scripts/migrate-pg-to-sqlite.ts` script and its `db:migrate-from-postgres`
    npm script, the `pg` / `@types/pg` dependencies, and any residual Postgres references in code
    comments, `.env.example`, and `server/db/` (e.g. the schema's "Postgres auto-indexes…" note). A repo
    grep for `pg`/`postgres`/`postgresql`/`timestamptz` should return only historical mentions in
    `docs/` revision histories afterward.
- Out of scope:
  - Cloudflare Worker entry, `wrangler.toml`, D1, R2, and Cloudflare Access (Milestone 15).
  - The online practice-mode behaviour and client capability-gating (Milestone 16). This milestone only
    *adds* the capabilities endpoint and reports all-true on Node; no client behaviour changes yet.
  - Any change to the data model or to scoring/transcription logic.

## Behaviour
From a developer's perspective; no end-user behaviour changes on the local app:

1. `npm run dev` starts the Hono server on Node (via `@hono/node-server`) on the same `PORT`; the Vite
   client proxies `/api/*` to it exactly as before.
2. Every existing endpoint — `/api/health`, `/api/sessions/*`, `/api/questions/*`, `/api/writing/*`,
   `/api/speaking/*` — responds with the same status codes, JSON envelopes, and error codes as the
   Express version, including range-aware audio/image/recording streaming (HTTP 206).
3. The 1 MB JSON body limit (writing essays) and the multipart speaking upload (≤ ~50 MB) continue to
   work; the unknown-`/api`-route fallback still returns the `NOT_FOUND` envelope.
4. `GET /api/health` returns `{ data: { status: 'ok', capabilities: { aiScoring: true,
   transcription: true, imports: true } }, error: null }` on the Node runtime.
5. The DB instance used by services is produced by the DB factory; on Node it is the libSQL client from
   `DATABASE_URL` (Milestone 13), constructed once.
6. Audio, passage-image, and speaking-recording bytes are served through the `MediaStore` interface;
   on Node the filesystem implementation reads from `MEDIA_DIR` with the same range semantics as today.
7. The unit/render suite (`npm test`) and the e2e suite (`npm run test:e2e`) pass against the Hono
   server.
8. The modules that spawn local CLIs (OCR/Whisper/Claude) and the import service are registered only by
   the Node entry; the portable core can be imported without pulling in `node:child_process`/`node:fs`.
9. No PostgreSQL code, dependency, script, or config remains: `pg`/`@types/pg` are gone from
   `package.json`, the `db:migrate-from-postgres` script and `scripts/migrate-pg-to-sqlite.ts` are
   deleted, and `npm install` pulls no Postgres driver. The only `postgres`/`postgresql` mentions left
   in the repo are historical notes in `docs/` revision histories.

## Data model changes
None.

## API contract
No new resource endpoints; one **additive** change to an existing one:

- `GET /api/health`
  - Response (success): `{ data: { status: 'ok', capabilities: { aiScoring: boolean, transcription:
    boolean, imports: boolean } }, error: null }`
  - The previous shape (`{ data: { status: 'ok' } }`) is extended, not broken: `status` is retained and
    `capabilities` is added. On Node all capability flags are `true`.

All other endpoints retain their exact paths, methods, request shapes, response shapes, and error codes.

### Runtime abstractions (implementation contract, not HTTP)
- **DB factory** — `createDb(env)` returns the Drizzle DB. Node: libSQL client from `DATABASE_URL`
  (constructed once and reused). Worker (M15): `drizzle(env.DB)` from the D1 binding, per request.
  Services receive the DB rather than importing a singleton, so the same service runs on both runtimes.
- **`MediaStore`** — minimal interface: `getRange(key, range?) → { body, size, contentType }`,
  `put(key, bytes, contentType)`, `exists(key)`. Node: filesystem under `MEDIA_DIR` (wrapping today's
  `fs.createReadStream` + Range logic). Worker (M15): R2 bucket (`bucket.get(key, { range })`,
  `bucket.put`). The stored `audio_files.file_path` / `passages.source_file` / recording path is the
  key the store resolves — a path relative to `MEDIA_DIR` under section subfolders (`listening/`,
  `reading/`, `speaking/`); `MEDIA_DIR` defaults to `<repo-root>/data/media` on Node. This relative
  key maps cleanly onto an R2 object key in the Worker runtime.
- **Capabilities** — a per-runtime object `{ aiScoring, transcription, imports }`. Node: all `true`.
  Worker (M15): all `false`. Surfaced via `/api/health` and used to decide which routes are mounted.

## Acceptance criteria
- [ ] Express and `multer` are removed from `server/`; Hono (+ `@hono/node-server`) is the only web framework; `server/index.ts` is the Node entry that mounts the portable core + the Node-only CLI routes and listens on `PORT`. (Behaviour.1, 8)
- [ ] Every endpoint returns byte-identical envelope shapes and error codes to the Express version, verified by the existing unit + e2e suites passing unchanged. (Behaviour.2, 7)
- [ ] Range-aware streaming (HTTP 206, `Content-Range`, partial body) works for audio, passage images, and speaking recordings through the `MediaStore` filesystem implementation. (Behaviour.2, 6)
- [ ] The 1 MB JSON limit and the multipart speaking upload both work under Hono; the unknown-`/api` fallback returns the `NOT_FOUND` envelope. (Behaviour.3)
- [ ] `GET /api/health` returns the `capabilities` object with all flags `true` on Node, alongside `status: 'ok'`. (Behaviour.4, API contract)
- [ ] Services obtain the Drizzle DB from `createDb(...)`; no service imports a DB singleton directly. (Behaviour.5)
- [ ] The portable core module can be imported in isolation without loading any module that imports `node:child_process` or `node:fs` (so the future Worker bundle excludes the CLI/import code). (Behaviour.8)
- [ ] `npm run dev` works with the unchanged Vite proxy; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass. (Behaviour.1, 7)
- [ ] `pg` / `@types/pg` are gone from `package.json`, the `db:migrate-from-postgres` script and `scripts/migrate-pg-to-sqlite.ts` are deleted, and a fresh `npm install` installs no Postgres driver. (Behaviour.9)
- [ ] A repo-wide grep for `pg`/`postgres`/`postgresql`/`timestamptz` (excluding `docs/`) returns no matches in code, config, or `.env.example`. (Behaviour.9)

## Open questions
- **Hono body-size limits & multipart parity with multer.** Hono's `parseBody`/`formData` must accept
  the browser's `webm/opus` recording up to the existing ~50 MB cap and the 1 MB JSON essay limit. To
  confirm the limit configuration during implementation; if Hono needs different middleware, the spec is
  corrected (Rule 4).
- **Streaming on Node vs. Workers.** Node serves bytes from `fs` streams; Workers serve a `ReadableStream`
  from R2. The `MediaStore` interface must express ranges in a way both satisfy. Chosen shape:
  `getRange` returns a web `ReadableStream` (Node stream adapted via `@hono/node-server` helpers) plus
  size/contentType; to be validated that range + 206 works identically on both. (R2 side verified in M15.)
- **Per-request vs. singleton DB on Node.** Node can safely construct the libSQL client once; Workers
  must build per request from `env`. The factory supports both; whether to memoize on Node or always go
  through the factory is an implementation detail decided at coding time (no behavioural impact).
- **Does removing `multer` affect the speaking upload tests?** The speaking route's tests assert on the
  saved file and metadata, not on multer specifically; to be confirmed they pass unchanged.

## Revision history
- 2026-06-20: Initial draft (Milestone 14). Part of the Cloudflare-hosting initiative; depends on
  `database-sqlite.md` (M13, libSQL DB factory) and is the prerequisite for `cloud-deployment.md` (M15,
  Worker entry + D1/R2 implementations of these abstractions) and `content-deploy.md` (M16, client
  capability-gating that consumes the new `/api/health` capabilities).
- 2026-06-21: Added **PostgreSQL cleanup** to scope (Behaviour.9 + two acceptance criteria). M13 keeps
  `pg`/`@types/pg` and the one-time `db:migrate-from-postgres` script so data can be carried over; this
  milestone — run right after M13, once that migration has happened — deletes the script and the `pg`
  dependencies and strips residual Postgres references from code/config, leaving only historical mentions
  in `docs/`.
- 2026-06-22: Status moved draft → approved (Milestone 14). Ready to implement (after Milestone 13).
