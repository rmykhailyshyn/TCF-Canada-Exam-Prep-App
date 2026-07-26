# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This file is the source of truth for Claude Code working on this project.
> It defines architecture decisions, workflow rules, coding conventions, and
> how spec-driven development is applied here. Read it fully before touching any code.

---

## Project Overview

**Name:** TCF Canada Exam Prep App  
**Purpose:** Local web application for self-study of the TCF Canada reading and listening exam sections.  
**Development approach:** Spec-Driven Development (SDD) — every feature begins with a written spec, and code follows the spec, not the other way around.

This project also serves as a **testbed for evaluating spec-driven development** as a methodology. Observations about what works and what breaks down belong in `docs/sdd-learnings.md`.

---

## Stack

| Layer               | Technology                                                    |
| ------------------- | ------------------------------------------------------------- |
| Frontend            | React 18, Vite, Tailwind CSS, TypeScript                      |
| Backend             | Hono (on @hono/node-server locally; Worker-ready), TypeScript |
| Database            | SQLite (libSQL) via Drizzle ORM                               |
| Audio transcription | Whisper CLI (Apple Silicon, `mlx-whisper` or `whisper.cpp`)   |
| OCR                 | Tesseract OCR (CLI)                                           |
| Package manager     | npm                                                           |

All tooling is local-first. No cloud services, no external APIs, no auth layer.

**Platform note:** The frontend, backend, and database are platform-agnostic (Windows and macOS) — SQLite is a single local file (`DATABASE_URL=file:./data/tcf_prep.db`), so there is no Docker/Postgres setup on any OS. The OCR and audio transcription pipelines (`scripts/`, `server/services/`) require Apple Silicon and must only be invoked on macOS. Never add OS-specific assumptions to `client/` or `server/` code outside of those services.

---

## Spec-Driven Development Rules

These rules are **non-negotiable** for this project. Their purpose is to generate clean signal about whether SDD improves output quality.

### Rule 1 — Spec before code

No implementation file may be created or modified for a new feature without a corresponding spec in `docs/specs/`. If a spec doesn't exist, write it first, then pause and wait for approval before coding.

### Rule 2 — Spec structure

Every spec file must use this template:

```markdown
# Spec: <Feature Name>

## Status

draft | approved | implemented | revised

## Goal

One paragraph. What problem does this solve? What should the user be able to do?

## Scope

- In scope: …
- Out of scope: …

## Behaviour

Numbered list of observable behaviours. Written from the user's perspective.
No implementation detail here — only what the system should do, not how.

## Data model changes (if any)

Drizzle schema additions or modifications.

## API contract (if any)

Endpoint, request shape, response shape, error cases.

## Acceptance criteria

Checklist of concrete, testable pass/fail conditions that verify the spec is implemented.
Each item references the behaviour or API item it covers, e.g. `(Behaviour.3)` or `(API contract)`.

## Open questions

Unresolved decisions that need an answer before implementation begins.

## Revision history

- YYYY-MM-DD: …
```

### Rule 3 — Spec approval gate

A spec moves from `draft` to `approved` only when the human explicitly confirms it. Claude Code must not begin implementation on a `draft` spec.

### Rule 4 — Divergence is a spec defect, not a code defect

If implementation reveals the spec was wrong or incomplete, update the spec first and flag the revision. Do not silently patch the code to paper over a spec gap.

### Rule 5 — Traceability comments

Every non-trivial function or component must include a one-line comment referencing its spec:

```typescript
// spec: docs/specs/listening-player.md §Behaviour.3
```

---

## Project Structure

```
/
├── client/                  # React frontend (platform-agnostic)
│   ├── src/
│   │   ├── components/      # Shared UI components
│   │   ├── features/        # Feature-scoped folders (co-locate component + hook + types)
│   │   ├── pages/           # Route-level components
│   │   ├── lib/             # Utilities, helpers
│   │   └── main.tsx
│   ├── tsconfig.json        # Client-specific TS config
│   └── vite.config.ts
│
├── server/                  # Hono backend (platform-agnostic; Node + Worker)
│   ├── app.ts               # Portable core (createCoreApp) — runs on Node and Workers
│   ├── routes/              # One file per resource (+ node-only / practice extensions)
│   ├── services/            # Business logic, separated from route handlers
│   │   │                    # Whisper + Tesseract wrappers live here (Apple Silicon only)
│   ├── runtime/             # MediaStore (Node/filesystem + R2), capabilities flags
│   ├── db/
│   │   ├── schema.ts        # Drizzle schema (single source of truth)
│   │   └── migrations/      # Generated by drizzle-kit
│   ├── tsconfig.json        # Server-specific TS config
│   ├── index.ts             # Node entry (@hono/node-server)
│   └── worker.ts            # Cloudflare Worker entry (D1 + R2, practice-only)
│
├── docs/
│   ├── specs/               # All feature specs live here
│   ├── milestones.md        # Roadmap
│   └── sdd-learnings.md     # Observations about the SDD process itself
│
├── scripts/                 # CLI helpers (import audio, run OCR, seed DB)
├── CLAUDE.md                # This file
└── package.json
```

---

## Coding Conventions

### TypeScript

- Strict mode on (`"strict": true` in tsconfig). No `any` unless escape-hatched with a comment explaining why.
- Prefer `type` over `interface` for data shapes. Use `interface` only for extensible contracts.
- Explicit return types on all exported functions.

### React

- Functional components only. No class components.
- Custom hooks live in `features/<name>/use<Name>.ts`. Hooks do not import from other hooks in different feature folders — go through a service or a shared lib instead.
- No prop drilling past two levels. Use context or co-locate state closer to where it's needed.
- Keep components under 200 lines. If a component is growing, split it.

### Hono

- Route handlers are thin: validate input, call a service, return the result. Business logic belongs in `services/`.
- One backend codebase runs on Node (`@hono/node-server`) locally and on Cloudflare Workers. Keep the **portable core** (`server/app.ts`) free of `node:*` APIs; Node-only logic (CLI imports, AI scoring, transcription) lives in the Node-only route/service extensions, never in the core.
- All routes return consistent JSON envelopes:
  ```json
  { "data": <payload>, "error": null }
  { "data": null, "error": { "code": "...", "message": "..." } }
  ```
  This envelope shape is enforced at the route layer only — services return plain typed values or throw, never shaped envelopes.
- No raw SQL. All database access goes through Drizzle queries.

### Drizzle

- Schema changes require a migration. Never mutate the DB directly during development.
- Run `drizzle-kit generate` after every schema change. Commit both the schema and the migration together.
- The database connection string is read from `DATABASE_URL` in `.env` (a libSQL `file:` URL; relative paths resolve against the repo root). Never hardcode connection details.

### Whisper / Tesseract

- CLI calls are wrapped in `scripts/` or `server/services/`. Never inline shell commands in route handlers.
- Always handle non-zero exit codes explicitly. Log stderr for debugging.

---

## Milestones

Track detailed status in `docs/milestones.md`. High-level order:

1. Project scaffold + DB setup
2. Reading section: question import (OCR pipeline), quiz UI
3. Listening section: audio import (Whisper pipeline), player + quiz UI
4. Progress tracking + session history
5. Question bank export / import (web UI: filter by section + complexity, JSON, override on re-import)
6. Review mode (show wrong answers, retry)
7. LLM enrichment pass (per-question English explanations citing passage/transcript clues, via the local Claude CLI)
8. Randomized question selection & ordering (learning: random order; real: one random question per sequence position) + reading passage image shown above its OCR text
9. SDD retrospective + polish
10. Writing section: free-text tasks import (markdown task bank) + session/UI (training mode with sample answers, templates & on-request Claude correction; real mode with a single 60-min limit) + per-task score/feedback via the local Claude CLI on submit
11. Speaking section: spoken tasks import (JSON task bank) + session/UI with in-browser voice recording (training mode with sample answers & on-request correction; real mode with per-task TCF timing) + recordings transcribed by the local Whisper CLI and scored per task (/20 + NCLC + feedback) by the local Claude CLI on submit
12. UI polish: (a) on-screen virtual keyboard for French accents (é, à, ç, …) in the Writing editor, mirroring the real TCF Canada exam software's keyboard; (b) unified section navigation — all four sections (Reading, Listening, Writing, Speaking) selectable from the landing screen and a persistent top menu

**Cloudflare hosting initiative (Milestones 13–16):** host the app online on Cloudflare's free tier while keeping the full local experience. See the Cloudflare deployment section below.

13. Database migration to SQLite/libSQL (local; replaces PostgreSQL — no Docker, app + DB run on Windows)
14. Portable server runtime (Express → Hono; one codebase on Node + Workers; DB factory, `MediaStore`, `GET /api/health` capabilities flags)
15. Cloudflare deployment (single Worker + Static Assets + D1 + R2 + Access; practice-only, all capabilities `false`)
16. Content seeding + online practice mode + client capability-gating (`npm run deploy:content`; online Writing/Speaking show sample answers, no AI score; unscored history)
17. Selectable LLM provider — local CLI default + Claude HTTP API (`LLM_PROVIDER`); lets the Worker score online when an API key is bound (**draft — spec written, awaiting approval**)
18. Reliability — free local **Node-native** static analysis (ESLint security+invariants pass, `npm run analyze`) + test-coverage tracking for both the unit (vitest) and e2e (client + server) suites, both gating (**implemented**)

---

## Commands

```bash
# Install dependencies
npm install

# Start dev servers (client + server concurrently)
npm run dev

# Run DB migrations (creates the SQLite file at DATABASE_URL — no Docker, no database server)
npm run db:migrate

# Generate migration after schema change
npm run db:generate

# Seed a full 39-question reading section for local UI/dev (not part of any spec)
npm run seed:dev

# One-time setup for the import pipeline: Python venv with pdfplumber (+ Tesseract for OCR)
python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt
# brew install tesseract tesseract-lang   # required for the passage-image OCR path

# Import reading questions from a directory (Apple Silicon only)
# Directory must contain one results PDF and one passage image per question
# (filename contains the question's sequence number, e.g. comprehension-ecrite-25Q39.png)
# Each image is COPIED into MEDIA_DIR/reading/ and the DB stores the path relative to MEDIA_DIR.
npm run ocr -- --dir <path>

# Import listening questions from a directory (Apple Silicon only)
# Directory must contain one results PDF and up to 39 MP3 files
# Each MP3 is COPIED into MEDIA_DIR/listening/ and the DB stores the path relative to MEDIA_DIR.
npm run transcribe -- --dir <path>

# Media (listening audio, reading images, speaking recordings) lives under MEDIA_DIR — defaults to
# ./data/media (alongside the SQLite DB), in section subfolders listening/ reading/ speaking/. The
# DB stores paths RELATIVE to MEDIA_DIR so the data is portable; the serve layer resolves them.
# Override the location with MEDIA_DIR in .env. Rewrite any legacy absolute paths to the relative
# form (and copy files into the store) with:
npm run db:migrate-media

# Import Writing tasks from a directory of markdown files (Milestone 10; platform-agnostic).
# Each *.md file is one task: front-matter (taskNumber 1-3, optional title/minWords/maxWords) +
# `## Prompt` (required) / `## Sample answer` / `## Template`. Idempotent on (source_file, task_number).
npm run import:writing -- --dir samples/writing-tasks      # sample bank included in the repo
npm run import:writing -- --dir <path> --dry-run           # parse + print, write nothing
# Writing responses are scored at submit time by the LOCAL Claude CLI (per-task /20 + NCLC + feedback);
# configure CLAUDE_CLI_BIN / CLAUDE_CLI_MODEL in .env (same as enrichment). NCLC is derived from the
# score (server/lib/nclc.ts), never produced by the model.

# Import Speaking tasks from a single JSON file (Milestone 11; platform-agnostic — no audio at import).
# The file is a JSON array of { task (1-3), question, answer? } objects; the array index is the task's
# `sequence`. Idempotent on (source_file, sequence). Skip-and-continue on bad elements.
npm run import:speaking -- --file samples/speaking-tasks/sample-bank.json   # sample bank in the repo
npm run import:speaking -- --file <path.json> --dry-run                     # parse + print, write nothing
# Speaking sessions record voice in the browser; on upload the recording is transcribed by the LOCAL
# Whisper CLI (scripts/lib/whisper.ts — Apple Silicon/macOS only, like the listening import), and on
# submit the transcript is scored by the LOCAL Claude CLI (/20 + NCLC + feedback). Recordings are saved
# under MEDIA_DIR. NCLC is derived from the score (server/lib/nclc.ts), never produced by the model.

# Generate per-question explanations via the LOCAL Claude CLI (Milestone 7; needs `claude` on PATH).
# Idempotent (skips questions that already have one). Reading uses the passage, listening the
# transcript, as the clue source; explanations are in English. Configure CLAUDE_CLI_BIN /
# CLAUDE_CLI_MODEL in .env (no API key).
npm run enrich                        # all questions without an explanation
npm run enrich -- --section reading   # limit to a section
npm run enrich -- --question-id <id>  # a single question
npm run enrich -- --dry-run           # print prompt + model output, write nothing

# Type-check without emitting (runs both client and server)
npm run typecheck

# Type-check client or server individually
npm run typecheck:client
npm run typecheck:server

# Lint
npm run lint

# Static analysis (SAST) — Node-native, offline, a BLOCKING gate step (Milestone 18a).
# A dedicated ESLint pass (config: eslint.analysis.config.js), SEPARATE from `npm run lint`:
#   - eslint-plugin-security + eslint-plugin-no-unsanitized (client) — injection/unsafe-DOM heuristics
#   - type-aware typescript-eslint (recommendedTypeChecked) — floating promises, unsafe any, etc.
#   - the repo-local `invariants` plugin (tools/eslint-plugin-invariants/) enforcing CLAUDE.md rules:
#     portable-core-no-node-builtins, no-raw-sql, thin-route-handlers, shell-out-location (all `error`),
#     plus no-any-without-comment (advisory `warn`).
npm run analyze
# Read a finding as: <file>:<line>:<col>  <severity>  <message>  <ruleId>. Triage each:
#   - fix the code, OR
#   - suppress with a rationale on the line above the finding:
#       // eslint-disable-next-line <ruleId> -- <why this is safe here>
#     (a bare disable with no rationale is itself a smell — always explain).
# `error`-level findings FAIL the gate (exit non-zero); `warn` (advisory no-any-without-comment) is
# reported but does NOT fail. Keep `npm run analyze` at 0 errors.
# Add a new project-invariant rule:
#   1. tools/eslint-plugin-invariants/rules/<rule-id>.js  (a rule whose message cites the CLAUDE.md invariant)
#   2. register it in tools/eslint-plugin-invariants/index.js
#   3. wire its severity in eslint.analysis.config.js (structural invariants → `error`; advisory → `warn`)
#   4. add a RuleTester test tools/eslint-plugin-invariants/rules/<rule-id>.test.ts (valid + invalid cases)

# Run all unit / render tests (vitest)
npm test

# Run a single test file
npm test -- <path/to/file.test.ts>

# Run the end-to-end regression suite (Playwright; specs in e2e/).
# Uses Playwright's bundled Chromium and reuses a running `npm run dev`, else starts one.
# global-setup seeds reading + listening dev data (generating the listening MP3s with ffmpeg),
# so the suite is self-contained. One-time browser install: `npx playwright install chromium`.
npm run test:e2e

# Test coverage (unit + e2e), combined report + BLOCKING threshold gate (Milestone 18b).
# All coverage output lands under coverage/ (gitignored — never committed): unit → coverage/unit,
# e2e client → coverage/e2e-client, e2e server → coverage/e2e-server, merged → coverage/combined.
npm run coverage:unit          # vitest with the istanbul provider → coverage/unit (text summary + lcov + json)
npm run coverage:e2e           # COVERAGE=1 playwright run: client (vite-plugin-istanbul) + server (c8)
npm run coverage               # runs unit + e2e, merges all three via nyc, prints the text-summary total
#                                and enforces the committed per-metric threshold in .nycrc.json.
# Read the text-summary block (Lines / Branches / Funcs / Stmts, % covered). The combined `coverage`
# run is the gate: nyc check-coverage exits non-zero if any metric drops below its .nycrc.json minimum.
# Adjust the threshold in .nycrc.json (per-metric: lines / branches / functions / statements). Ratchet
# these UPWARD as coverage improves; never lower them to make a red gate pass.

# Seed a 4-question listening band (Beginner) with generated audio + authored transcripts, for
# exercising the listening UI without the Whisper import (not part of any spec; needs ffmpeg)
npm run seed:listening-dev
```

---

## Cloudflare deployment (Milestones 13–16)

The app can be hosted online as a **single Cloudflare Worker** (free tier) that serves the built SPA
(Workers Static Assets) plus the Hono `/api/*` portable core, bound to **D1** (data) and **R2**
(media), gated by **Cloudflare Access**. The online instance is **practice-only**: `GET /api/health`
reports `capabilities` all-`false` and the CLI-backed routes (imports, AI scoring, transcription,
correction, enrichment) are never mounted — no Whisper/Tesseract/Claude binary runs on Workers. Local
dev (`npm run dev`) is unaffected. Config lives in `wrangler.toml`; the Worker entry is
`server/worker.ts`.

```bash
# 0. One-time: authenticate wrangler with your Cloudflare account
npx wrangler login

# 1. Provision D1 + R2, then paste the printed database_id into wrangler.toml ([[d1_databases]])
npx wrangler d1 create tcf-prep
npx wrangler r2 bucket create tcf-prep-media

# 2. Apply the Milestone 13 SQLite baseline to D1 (creates all tables; empty, un-seeded)
npm run cf:d1:migrate                 # wrangler d1 migrations apply DB --remote
#   …add --local for the wrangler dev D1, e.g.: npx wrangler d1 migrations apply DB --local

# 3. Build the client + deploy the Worker
npm run cf:deploy                     # npm run build && wrangler deploy

# 4. Optional: run the Worker locally against a local D1 + R2 (cloud parity; does not touch npm run dev)
npm run cf:dev                        # wrangler dev

# 5. Push locally-imported content to the cloud (Milestone 16; import locally → deploy). Dumps every
#    content table from the local SQLite DB as idempotent INSERT OR REPLACE SQL and applies it to D1 via
#    `wrangler d1 execute --file`, then uploads referenced media (MP3s, passage images) to R2 under the
#    same relative keys the R2 MediaStore reads. Re-running overwrites in place. Needs `wrangler login`.
npm run deploy:content                 # push content + media to remote D1 + R2
npm run deploy:content -- --dry-run     # print the generated SQL + planned R2 uploads, change nothing
npm run deploy:content -- --local       # target the local `wrangler dev` D1/R2 instead of remote
# Override the D1 name / R2 bucket with D1_DATABASE / R2_BUCKET env vars (defaults: tcf-prep,
# tcf-prep-media). A freshly deployed Worker has an empty D1/R2 until deploy:content is run.
```

**Online practice-only behaviour (Milestone 16).** The deployed Worker reports `capabilities` all-`false`,
so the client hides the import panel, AI score/feedback, "Get correction", and the transcript. Online,
Writing **submit** locks the response without a score (sample answer/template shown instead), Speaking is
record + playback + sample answer (no Whisper, no score), and completed online sessions appear in history
**unscored** (no fabricated /20). AI scoring/transcription remain local-only. The client fails safe to the
most-restrictive capabilities if `/api/health` is unreachable.

**Access control.** Default is **Cloudflare Access** (Zero Trust, free): in the dashboard, add a
self-hosted Access application for the Worker's route and a policy allowing only your identity (email
OTP or an IdP). This needs **no application code** — the Worker only ever sees authenticated requests.

_Fallback (no Access):_ set a Worker secret and the Worker enforces a shared-secret header itself:

```bash
npx wrangler secret put ACCESS_SHARED_SECRET      # production
# For `wrangler dev`, put it in a local .dev.vars file (gitignored): ACCESS_SHARED_SECRET=<value>
```

When `ACCESS_SHARED_SECRET` is set, every request must carry `X-Access-Secret: <value>` or it gets a
`401 UNAUTHORIZED` envelope (see `server/worker.ts`). When unset, the middleware is a no-op and Access
gates the Worker in front.

**D1 free-tier limits.** The free plan allows generous daily rows-read/written and ~5 GB storage — a
single-user practice app is far inside them, but if usage grows this becomes a conscious decision (see
Cloudflare's current D1 limits).

**Notes.** `nodejs_compat` is enabled in `wrangler.toml` for the few Node built-ins the portable core
may touch. D1 enforces foreign keys; the baseline migration's `references(...)` constraints behave as
local. `wrangler deploy` / D1 provisioning require your Cloudflare credentials and were not exercised
in CI — the local checks (`npm run typecheck`, `npm test`, `npm run build`) cover the worker code path.

---

## Invariants

- Always check `docs/specs/` before writing feature code. No spec → write it first, then wait for approval.
- Only the human moves a spec from `draft` → `approved`. Never self-approve.
- After implementing a spec, update its `Status` to `implemented`.
- If implementation reveals a spec gap, update the spec first and flag the revision — do not silently patch the code.
- Add the spec traceability comment (`// spec: docs/specs/<file>.md §Behaviour.N`) to every non-trivial function.
- Keep `docs/sdd-learnings.md` updated with observations about the SDD process.
- Never write business logic inside route handlers — services only.
- Never use `any` without an inline comment explaining why.
- Never run `git commit` unless directly asked to do so.
- Never add Apple Silicon / macOS-specific logic outside of `scripts/` and `server/services/` wrappers for OCR and Whisper.

---

## SDD Evaluation Notes

This section is for meta-observations about the methodology itself. Add entries as the project progresses.

See `docs/sdd-learnings.md` for the full log.

Key questions being evaluated:

- Does writing specs before code reduce rework?
- Does the spec approval gate cause friction, or does it prevent bad decisions?
- Are spec traceability comments useful during debugging, or just noise?
- How well does this workflow scale to a solo dev vs. a small team?
