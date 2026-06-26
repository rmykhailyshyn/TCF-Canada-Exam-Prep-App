# Spec: Cloudflare Deployment (Worker + Static Assets + D1 + R2 + Access)

## Status

approved

## Goal

Host the app online on Cloudflare's **free tier** as a single Worker that serves the built React client
(via Workers Static Assets) and the Hono `/api/*` routes (the portable core from Milestone 14), backed
by **Cloudflare D1** (the same SQLite schema as local, Milestone 13) for data and **Cloudflare R2** for
media (audio, passage images, recordings). The online instance is **practice-only**: it reports
`capabilities = { aiScoring: false, transcription: false, imports: false }` and never mounts the
CLI-backed routes, so no Whisper/Tesseract/Claude binary is required (none can run on Workers). Access
is restricted to the single user via **Cloudflare Access** (Zero Trust, free), with no application-level
auth code. Local development and the full local feature set (Milestones 13–14) are unaffected; this
milestone adds the cloud target alongside them. Content seeding into D1/R2 and the client's UI gating on
capabilities are Milestone 16 — this milestone establishes the running, access-gated cloud runtime.

## Scope

- In scope:
  - `wrangler.toml` defining one Worker: `main` = a new `server/worker.ts` entry, `[assets]` serving
    `client/dist` (SPA), `[[d1_databases]]` binding `DB`, `[[r2_buckets]]` binding `MEDIA`,
    `compatibility_date` + `nodejs_compat` as needed by the portable core.
  - `server/worker.ts`: the Workers entry that imports the **portable Hono core** (Milestone 14),
    constructs the DB via the factory from the `DB` (D1) binding, wires the **R2 `MediaStore`**
    implementation, sets `capabilities` all-`false`, and does not register the CLI-backed routes.
  - **R2 `MediaStore`** implementation of the Milestone 14 interface: range reads
    (`bucket.get(key, { range })`), `put`, `exists` — media file paths/keys resolve to R2 object keys
    in the cloud.
  - **Routing**: `/api/*` handled by Hono; all other paths served from static assets with SPA fallback
    to `index.html`.
  - **Cloudflare Access** in front of the Worker, restricted to the user's identity (configured in the
    Cloudflare dashboard / documented as deploy steps; no app code). A documented fallback: a
    shared-secret header check as Hono middleware if Access is unavailable.
  - **D1 schema provisioning**: apply the Milestone 13 SQLite baseline migration to D1
    (`wrangler d1 migrations apply`), creating an empty (un-seeded) database.
  - Build/deploy scripts in `package.json`: build the client then `wrangler deploy`; optional
    `wrangler dev` for local cloud-parity testing against a local D1 + R2.
  - Documentation: CLAUDE.md (deployment section + commands), `.dev.vars`/secret handling notes.
- Out of scope:
  - Loading real content into D1/R2 and uploading media (Milestone 16, `content-deploy.md`).
  - Client capability-gating and online practice-mode UI behaviour (Milestone 16).
  - Multi-user accounts / per-user data isolation (single-user by decision; the data model has no user
    concept and none is added).
  - Any change to local runtime behaviour or the data model.

## Behaviour

1. `npm run build` produces `client/dist`; `wrangler deploy` publishes one Worker that serves the SPA at
   the root URL and the API under `/api/*`.
2. Unauthenticated requests to the deployed URL are intercepted by **Cloudflare Access** and must
   authenticate as the permitted user before reaching the Worker; the user's own access is seamless
   after login.
3. `GET /api/health` on the deployed Worker returns `{ data: { status: 'ok', capabilities: {
aiScoring: false, transcription: false, imports: false } }, error: null }`.
4. Read/practice endpoints that need no CLI work against D1: listing/creating reading & listening
   sessions, recording answers, completing sessions, fetching questions/transcripts, exporting, and the
   writing/speaking **session + draft + sample-answer** reads all function (against whatever content
   M16 has seeded).
5. The CLI-backed routes (imports, enrichment, AI scoring submit, correction, transcription) are **not
   mounted** on the Worker; requests to them return the standard `NOT_FOUND` envelope.
6. Audio, passage-image, and recording bytes stream from **R2** through the `MediaStore`, with the same
   range/206 semantics as local, so audio seeking works in the browser.
7. The Drizzle DB on the Worker is created per request from the `DB` (D1) binding via the Milestone 14
   factory; no `DATABASE_URL` / filesystem is used in the cloud.
8. `wrangler dev` runs the same Worker locally against a local D1 + R2 for parity testing, without
   affecting the Node dev server (`npm run dev`).

## Data model changes

None. D1 uses the identical SQLite schema and baseline migration produced in Milestone 13.

## API contract

No new endpoints. The contract is the Milestone 14 portable-core subset, with `capabilities` reported as
all-`false`. Endpoint paths, request/response shapes, error codes, and the JSON envelope are unchanged.
(Infrastructure config — `wrangler.toml` bindings — is not an HTTP contract.)

Bindings (operational contract):

- `DB` — D1 database binding consumed by the DB factory.
- `MEDIA` — R2 bucket binding consumed by the `MediaStore`.
- `[assets]` — directory binding for `client/dist` with SPA fallback.

## Acceptance criteria

- [ ] `wrangler.toml` defines one Worker with `main: server/worker.ts`, an `[assets]` binding for `client/dist`, a `DB` D1 binding, and a `MEDIA` R2 binding. (Behaviour.1, 6, 7)
- [ ] `wrangler deploy` (after `npm run build`) publishes successfully and the root URL serves the SPA; deep links fall back to `index.html`. (Behaviour.1)
- [ ] Cloudflare Access gates the deployed URL to the permitted user; an unauthenticated request is challenged before reaching the Worker. (Behaviour.2)
- [ ] The shared-secret header middleware fallback is documented in CLAUDE.md with setup instructions; when enabled, a request carrying the correct secret header reaches the Worker without going through the Access gate. (Scope)
- [ ] `GET /api/health` on the deployed Worker returns `capabilities` all-`false`. (Behaviour.3, API contract)
- [ ] The portable read/practice endpoints succeed against D1; the CLI-backed routes return `NOT_FOUND` (not a 500). (Behaviour.4, 5)
- [ ] Audio/image/recording range requests stream from R2 with HTTP 206 and correct `Content-Range`; browser audio seeking works. (Behaviour.6)
- [ ] The Milestone 13 baseline migration applies cleanly to D1 via `wrangler d1 migrations apply`, creating all tables. (Behaviour.4)
- [ ] `wrangler dev` runs the Worker locally against local D1 + R2 without disturbing `npm run dev`. (Behaviour.8)
- [ ] The Worker bundle contains no `node:child_process` import (verified by a successful Workers build, which would otherwise fail or require unused polyfills). (Scope; relies on the M14 portable-core split)

## Open questions

- **`nodejs_compat` extent.** The portable core may transitively use a few Node built-ins (e.g. `node:path`
  for key handling). To confirm which compat flags / polyfills the Worker build needs, and to remove or
  replace any that pull in heavy/unsupported modules. (Rule 4 during implementation.)
- **D1 free-tier limits.** Free D1 allows generous reads/writes and storage; a single-user practice app is
  far within them, but the limits (rows read/day, DB size) should be noted in CLAUDE.md so future growth is
  a conscious decision.
- **D1 foreign-key enforcement.** D1 supports FKs but the enforcement/PRAGMA story differs from libSQL; to
  confirm the baseline migration's `references(...)` constraints behave the same on D1 as local. If D1
  defers FK checks, document it.
- **Cloudflare Access vs. shared-secret fallback.** Access requires a (free) Zero Trust setup tied to an
  identity provider/one-time-PIN. If that is undesirable, the documented fallback is a shared-secret header
  middleware in the Worker. Decision recorded at deploy time; default is Access (zero app code).
- **Static-asset + API routing precedence.** Confirm Workers Static Assets does not shadow `/api/*` (asset
  routing must yield to the Hono API for that prefix); set `run_worker_first`/route config accordingly.

## Revision history

- 2026-06-20: Initial draft (Milestone 15). Part of the Cloudflare-hosting initiative; depends on
  `database-sqlite.md` (M13, shared SQLite schema for D1) and `server-runtime.md` (M14, portable Hono core
  - DB factory + `MediaStore` + capabilities). Prerequisite for `content-deploy.md` (M16, seeding D1/R2 and
    client gating). Decisions locked with the user: practice-only online, single user (Cloudflare Access),
    free tier.
