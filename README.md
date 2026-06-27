# TCF Canada Exam Prep App

A **local-first** web application for self-study of the TCF Canada exam across all four sections —
**Reading, Listening, Writing, and Speaking**. It lets you import real exam material, practise under
training or exam-realistic conditions, track your progress, and get AI-assisted explanations,
corrections, and scoring — all running on your own machine with **no cloud services, no external
APIs, and no auth layer**.

The project is built with **Spec-Driven Development (SDD)**: every feature begins as a written spec
in [`docs/specs/`](docs/specs/), and code follows the spec. It doubles as a testbed for evaluating
SDD as a methodology (see [`docs/sdd-learnings.md`](docs/sdd-learnings.md)).

> The frontend, backend, and database are **platform-agnostic** (macOS + Windows). The **import
> pipelines** for OCR (Tesseract) and audio/voice transcription (Whisper) require **Apple Silicon /
> macOS**. Everything else — practising, reviewing, exporting — runs anywhere.

It can also be deployed online as a single **Cloudflare Worker** in **practice-only** mode (see
[Cloudflare deployment](#cloudflare-deployment)).

---

## Stack

| Layer               | Technology                                                    |
| ------------------- | ------------------------------------------------------------- |
| Frontend            | React 18, Vite 6, Tailwind CSS, TypeScript                    |
| Backend             | Hono (on `@hono/node-server` locally; Worker-ready), TypeScript |
| Database            | SQLite (libSQL) via Drizzle ORM                               |
| Audio / voice       | Whisper CLI (Apple Silicon — `mlx_whisper`)                   |
| OCR                 | Tesseract OCR (CLI)                                           |
| AI scoring / enrich | Local Claude CLI (no API key)                                 |
| Package manager     | npm (workspaces: `client`, `server`)                          |

---

## Prerequisites

- **Node.js** (LTS) and **npm** — required, all platforms.
- **macOS / Apple Silicon** — required only for the import pipelines below.

Optional tools, needed only for specific scripts:

| Tool                  | Needed for                                  | Install                                          |
| --------------------- | ------------------------------------------- | ------------------------------------------------ |
| Tesseract             | Reading import OCR (`npm run ocr`)          | `brew install tesseract tesseract-lang`          |
| `mlx_whisper`         | Listening / Speaking transcription          | Python package (set `WHISPER_CMD` in `.env`)     |
| `claude` CLI          | Enrichment, Writing/Speaking AI scoring     | Install Claude Code CLI; ensure `claude` on PATH |
| Python 3 venv         | PDF/text parsing in import scripts          | `python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt` |
| `ffmpeg`              | Dev seed audio + e2e suite                  | `brew install ffmpeg`                            |
| `wrangler`            | Cloudflare deploy (bundled as a devDep)     | provided via `npm install`                       |

---

## Quick start

```bash
# 1. Install dependencies (installs workspaces too)
npm install

# 2. Configure environment (all values have sensible defaults)
cp .env.example .env

# 3. Create the SQLite database file + apply migrations (no Docker, no DB server)
npm run db:migrate

# 4. (Optional) seed a full 39-question reading section for local UI work
npm run seed:dev

# 5. Start client + server together
npm run dev
```

`npm run dev` runs the Hono server (on `PORT`, default **3001**) and the Vite client concurrently;
the client dev server proxies `/api` to the server.

---

## Configuration

Configuration is read from a `.env` file at the repo root (copy from `.env.example`). Every variable
has a working default — an empty `.env` is valid for local practice.

| Variable           | Purpose                                                                                   | Default                                          |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`     | SQLite (libSQL) `file:` URL for Drizzle + server. Relative paths resolve against repo root. | `file:./data/tcf_prep.db`                        |
| `PORT`             | Backend server port (client proxies `/api` here).                                         | `3001`                                            |
| `MEDIA_DIR`        | Canonical on-disk media store (`listening/`, `reading/`, `speaking/`). DB stores paths relative to it. | `<repo-root>/data/media`              |
| `CLAUDE_CLI_BIN`   | Local Claude CLI binary for enrichment / AI scoring (not the HTTP API).                    | `claude` (on PATH)                                |
| `CLAUDE_CLI_MODEL` | Optional `--model` override for the Claude CLI.                                            | _(CLI default)_                                   |
| `WHISPER_CMD`      | MLX Whisper CLI binary for transcription (set to your venv binary).                        | `mlx_whisper`                                     |
| `WHISPER_MODEL`    | Whisper model identifier.                                                                  | `mlx-community/whisper-large-v3-turbo`            |
| `TESSERACT_BIN`    | Tesseract binary for reading-passage OCR.                                                  | `tesseract`                                       |
| `PYTHON_BIN`       | Python 3 binary used by import parsing scripts.                                            | `<repo-root>/scripts/.venv/bin/python3`           |
| `D1_DATABASE`      | Cloudflare D1 database name (used by `deploy:content`).                                    | `tcf-prep`                                        |
| `R2_BUCKET`        | Cloudflare R2 bucket name (used by `deploy:content`).                                      | `tcf-prep-media`                                  |

**Not read from `.env`:** `ACCESS_SHARED_SECRET` is a **Cloudflare Worker secret** (set via
`wrangler secret put`, or a local `.dev.vars` file for `wrangler dev`) — see
[Cloudflare deployment](#cloudflare-deployment). The Worker reads the rest of its config from
`wrangler.toml`, which defines the bindings `DB` (D1 `tcf-prep`) and `MEDIA` (R2 `tcf-prep-media`).

---

## Scripts

All commands are run from the repo root. Flags after `--` are passed through to the underlying
script (e.g. `npm run ocr -- --dir <path>`).

### Development & build

```bash
npm run dev                 # client + server concurrently (server on PORT, client proxies /api)
npm run dev:server          # server only (tsx watch)
npm run dev:client          # client only (vite)
npm run build               # build client SPA + type-check server (incl. worker)
npm run typecheck           # type-check client and server
npm run typecheck:client    # client only
npm run typecheck:server    # server only (node + worker tsconfigs)
npm run lint                # eslint over the repo
npm test                    # vitest unit / render tests
npm test -- <path>          # run a single test file
```

### Database (Drizzle + SQLite)

```bash
npm run db:generate         # generate a migration after editing server/db/schema.ts
npm run db:migrate          # apply migrations (creates the SQLite file at DATABASE_URL)
npm run db:migrate-media    # rewrite legacy absolute media paths to MEDIA_DIR-relative + copy files
```

Schema changes require a generated migration; commit the schema and migration together.

### Content import (Apple Silicon for OCR / Whisper)

```bash
# Reading: directory with one results PDF + one passage image per question.
# Filenames must contain the question's sequence number (e.g. comprehension-ecrite-25Q39.png).
# Images are COPIED into MEDIA_DIR/reading/; the DB stores the relative path.
npm run ocr -- --dir <path>

# Listening: directory with one results PDF + up to 39 MP3s.
# MP3s are COPIED into MEDIA_DIR/listening/; the DB stores the relative path.
npm run transcribe -- --dir <path>

# Writing tasks: a directory of markdown files (one task per file).
# Front-matter (taskNumber 1-3, optional title/minWords/maxWords) + `## Prompt` (required) /
# `## Sample answer` / `## Template`. Idempotent on (source_file, task_number).
npm run import:writing -- --dir samples/writing-tasks   # sample bank ships in the repo
npm run import:writing -- --dir <path> --dry-run        # parse + print, write nothing

# Speaking tasks: a single JSON file — array of { task (1-3), question, answer? }.
# The array index is the task's sequence. Idempotent on (source_file, sequence).
npm run import:speaking -- --file samples/speaking-tasks/sample-bank.json
npm run import:speaking -- --file <path.json> --dry-run  # parse + print, write nothing
```

> Writing responses and Speaking transcripts are scored **at submit time** by the local Claude CLI
> (per-task `/20` + NCLC + feedback). Speaking recordings are transcribed by the local Whisper CLI on
> upload. NCLC is derived from the score, never produced by the model.

### LLM enrichment (local Claude CLI)

Generates per-question English explanations citing the passage (reading) or transcript (listening).
Idempotent — skips questions that already have one. Needs `claude` on PATH.

```bash
npm run enrich                         # all questions without an explanation
npm run enrich -- --section reading    # limit to a section
npm run enrich -- --question-id <id>   # a single question
npm run enrich -- --dry-run            # print prompt + model output, write nothing
```

### Dev seeds (no import pipeline needed)

```bash
npm run seed:dev              # a full 39-question reading section for UI/dev
npm run seed:listening-dev   # a 4-question listening band with generated audio (needs ffmpeg)
```

### Testing

```bash
npm test                     # vitest (unit / render)
npm run test:e2e             # Playwright end-to-end suite (specs in e2e/)
npx playwright install chromium   # one-time browser install for e2e
```

The e2e suite reuses a running `npm run dev` (or starts one) and seeds its own reading + listening
data, so it is self-contained.

### Cloudflare deployment

```bash
npm run cf:dev               # run the Worker locally against local D1 + R2 (cloud parity)
npm run cf:deploy            # build client + wrangler deploy
npm run cf:d1:migrate        # apply SQLite baseline migrations to remote D1
npm run deploy:content       # push locally-imported content + media to remote D1 + R2
npm run deploy:content -- --dry-run   # print the generated SQL + planned R2 uploads
npm run deploy:content -- --local     # target the local wrangler dev D1/R2 instead of remote
```

See the [Cloudflare deployment](#cloudflare-deployment) section below for the full runbook.

---

## Project structure

```
/
├── client/        # React SPA (platform-agnostic) — components, features, pages, lib
├── server/        # Hono backend (platform-agnostic) — routes, services, db, worker.ts
│   ├── db/        # Drizzle schema (single source of truth) + migrations
│   └── services/  # Business logic; Whisper + Tesseract wrappers (Apple Silicon only)
├── scripts/       # CLI helpers — import, OCR, transcribe, enrich, seed, deploy
├── samples/       # Sample writing + speaking task banks (importable)
├── e2e/           # Playwright end-to-end specs
├── data/          # Local SQLite DB + media store (gitignored content)
├── docs/          # specs/, milestones.md, mockups.md, sdd-learnings.md
├── wrangler.toml  # Cloudflare Worker config + D1/R2 bindings
└── CLAUDE.md      # Contributor / agent source of truth
```

---

## Development workflow (Spec-Driven Development)

This project follows SDD strictly:

- **Specs first** — every feature has a spec in [`docs/specs/`](docs/specs/); code follows the spec,
  not the other way around. No implementation without an approved spec.
- **Roadmap** — milestones are tracked in [`docs/milestones.md`](docs/milestones.md).
- **Methodology log** — observations about SDD itself go in
  [`docs/sdd-learnings.md`](docs/sdd-learnings.md).
- **Source of truth** — [`CLAUDE.md`](CLAUDE.md) holds the full architecture decisions, coding
  conventions, and invariants for anyone (human or agent) working in the repo. Read it before
  touching code.

---

## Cloudflare deployment

The app can be hosted online as a **single Cloudflare Worker** (free tier) that serves the built SPA
(Workers Static Assets) plus the Hono `/api/*` core, bound to **D1** (data) and **R2** (media),
gated by **Cloudflare Access**. The online instance is **practice-only**: `GET /api/health` reports
`capabilities` all-`false`, and the CLI-backed routes (imports, AI scoring, transcription,
correction, enrichment) are never mounted — no Whisper / Tesseract / Claude binary runs on Workers.
Local dev is unaffected.

```bash
# 0. One-time: authenticate wrangler with your Cloudflare account
npx wrangler login

# 1. Provision D1 + R2, then paste the printed database_id into wrangler.toml ([[d1_databases]])
npx wrangler d1 create tcf-prep
npx wrangler r2 bucket create tcf-prep-media

# 2. Apply the SQLite baseline to D1 (creates all tables; empty, un-seeded)
npm run cf:d1:migrate                 # add --local for the wrangler dev D1

# 3. Build the client + deploy the Worker
npm run cf:deploy

# 4. Push locally-imported content + media to the cloud (import locally → deploy)
npm run deploy:content
```

**Access control.** The default is **Cloudflare Access** (Zero Trust, free) — add a self-hosted
Access application for the Worker's route in the dashboard; the Worker only ever sees authenticated
requests and needs no application code. _Fallback (no Access):_ set a Worker secret and the Worker
enforces a shared-secret header itself:

```bash
npx wrangler secret put ACCESS_SHARED_SECRET   # production
# For `wrangler dev`, put it in a gitignored .dev.vars file: ACCESS_SHARED_SECRET=<value>
```

When `ACCESS_SHARED_SECRET` is set, every request must carry `X-Access-Secret: <value>` or it gets a
`401 UNAUTHORIZED`. When unset, the check is a no-op and Access gates the Worker in front.
