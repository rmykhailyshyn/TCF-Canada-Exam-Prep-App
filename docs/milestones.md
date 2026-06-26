# Milestones

## Milestone 1 — Project scaffold + DB setup

**Status:** complete

- [x] Initialise monorepo: `client/` (React 18 + Vite 6 + Tailwind 3 + TS), `server/` (Express + TS) via npm workspaces
- [x] Configure Drizzle ORM with PostgreSQL (`DATABASE_URL` in `.env`)
- [x] Define initial schema (passages, questions, options, audio_files, transcript_segments, sessions, question_results, explanations)
- [x] Run first migration (verified against a Postgres 16 container — all 8 tables created)
- [x] `npm run dev` starts both client and server concurrently (verified: server `/api/health`, client proxy, 404 envelope)
- [x] `npm run typecheck`, `npm run lint` pass clean (plus `npm test` and `npm run build`)

**Specs:** none (scaffold only)

---

## Milestone 2 — Reading section: import pipeline + quiz UI

**Status:** complete

- [x] PDF import script: `npm run ocr -- --dir <path>` — discovers one results PDF + one passage image per question (filename carries the sequence number), parses options/answer key via the Python pdfplumber parser, OCRs each image into passage + question prompt (split at the footer), cross-checks the score, idempotently persists passages + questions + options. Validated against a **real reading** results PDF (reproduces 19/39 correct, 266/699 pts) and a real Q39 passage image (and earlier against a real listening PDF, 27/437).
- [x] Reading quiz UI: passage display, 4-option multiple-choice, confirm answer
- [x] Learning mode: immediate feedback after each answer (+ explanation slot)
- [x] Real mode: timed session (60 min / 39 questions), countdown, no feedback, auto/manual submit
- [x] Backend session API (`POST /api/sessions`, `/answers`, `/complete`) with weighted scoring (max 699), difficulty bands, `exam.config.json` timing
- [x] `npm run typecheck`, `npm run lint`, `npm test` (21 tests), `npm run build` all pass

**Spec corrections during implementation (SDD Rule 4):** real PDFs revealed two things the specs
got wrong/unknown. (1) The green/red answer fills are bezier `curves` (rounded-rect backgrounds),
not `rects`; exact RGB values recorded. (2) The reading PDF has no `"N. Question"` header and no
question text in its text layer — each question's passage **and** prompt live in a per-question
image (filename carries the sequence number), OCR'd and split at the `reussir-tcfcanada.com`
footer; the PDF supplies only options + answer key + score. Parser refactored to order-based
detection and re-validated against both real reading (19/266) and listening (27/437) PDFs. See
`docs/sdd-learnings.md`. A dev seed (`npm run seed:dev`) provides a full 39-question reading
section for exercising the UI without a full import.

**Specs:**

- `docs/specs/reading-import.md` (implemented)
- `docs/specs/quiz-session.md` (implemented)
- `docs/specs/reading-quiz-ui.md` (implemented)

---

## Milestone 3 — Listening section: import pipeline + player + quiz UI

**Status:** complete

- [x] Audio import script: `npm run transcribe -- --dir <path>` — discovers one results PDF + MP3s in directory, parses questions/options/correct answers from the PDF (shared parser, green-fill answer key), matches each MP3 to its question by the sequence number in its filename, transcribes via `mlx_whisper` (`WHISPER_CMD`/`WHISPER_MODEL` overridable), persists questions + options + audio path + transcript segments. Idempotent; score cross-check; per-question skip on indeterminate answer / missing MP3 / Whisper failure
- [x] Listening player: audio playback (play/pause/scrubber/volume) with phrase-level subtitle overlay, a moving highlight synced to playback, and auto-scroll
- [x] Clicking a subtitle segment seeks audio to that point and plays
- [x] Listening quiz UI: player above the 4-option multiple-choice, learning and real modes (35 min / 39 questions), options gated until audio loads; reuses the shared session hook + results screen
- [x] Backend player API: range-aware `GET /api/questions/:id/audio` stream + `GET /api/questions/:id/transcript`
- [x] `npm run typecheck`, `npm run lint`, `npm test` (42 tests), `npm run build` all pass

**Implementation notes (SDD Rule 4):** all four import open questions were resolved at
implementation time and recorded in `docs/specs/listening-import.md` — Whisper variant
(`mlx_whisper`, env-overridable), JSON output shape (seconds → ms via pure `parseWhisperJson`),
media naming (reuse `extractSequenceFromFilename`, handles both `q07.mp3` and `20Q7.mp3`), and
score mismatch (non-fatal warning). The player's static-vs-stream open question resolved to a
dedicated range-aware streaming route. Image-bearing questions (sample Q1–6) remain out of scope.
No DB migration was needed — `audio_files` and `transcript_segments` shipped in the Milestone 1
schema. The listening import was not run end-to-end here (Whisper requires Apple Silicon), but the
pure transform and the range/answer-key logic are unit-tested, and the shared PDF parser was
already validated against a real listening PDF (27/437).

**Specs:**

- `docs/specs/listening-import.md` (implemented)
- `docs/specs/listening-player.md` (implemented)
- `docs/specs/listening-quiz-ui.md` (implemented)

---

## Milestone 4 — Progress tracking + session history

**Status:** complete

- [x] Session model: type (reading | listening), mode (learning | real), started/completed timestamps
- [x] Per-question result: question id, chosen answer, correct/incorrect
- [x] Score calculation and display at session end
- [x] Real mode: elapsed time tracked and stored
- [x] Session history list page

**Specs:**

- `docs/specs/progress-tracking.md`

---

## Milestone 5 — Question bank export / import (web UI)

**Status:** complete

- [x] Question Bank page (`/question-bank`): Export panel filtering by section (reading/listening/both) and complexity (difficulty bands / all)
- [x] Export produces a versioned JSON document (options + answer key + passage / transcript + audio reference) downloaded by the browser as `tcf-export-<section>-<complexity>-YYYYMMDD.json`
- [x] Import panel: upload a previously exported JSON file with an "override existing" toggle, showing an `{ inserted, overridden, skipped, total, warnings }` summary
- [x] Import matches on the `(source_file, sequence)` natural key — insert when absent, skip or overwrite in place (same `questions.id`, preserving session history)
- [x] Structural + answer-key validation before any write, in a single transaction; failed validation leaves the DB unchanged
- [x] Backend API: `GET /api/questions/export`, `POST /api/questions/import`
- [x] `npm run typecheck`, `npm run lint`, `npm test` (64 tests), `npm run build` all pass

**Implementation notes (SDD Rule 4):** the spec's "configured media directory" was unnamed; it is
resolved by a new `MEDIA_DIR` env var (defaults to `<repo-root>/media`). Listening export carries
the MP3 basename only; import joins it onto `MEDIA_DIR` and warns non-fatally when the file is
absent on disk (the reference still imports). No schema change — override reuses the existing
`UNIQUE(source_file, sequence)`. Verified end-to-end against the dev DB (export→import round trip,
override-in-place preserves `questions.id`, all four error envelopes).

**Specs:**

- `docs/specs/question-export-import.md` (implemented)

---

## Milestone 6 — Review mode

**Status:** complete

- [x] After a session ends, user can enter review mode — from the results summary "Review answers" button and from a history session row (`/review/:id`); read-only
- [x] Shows each question in order with the user's answer (red if wrong) and the correct answer (green), plus the passage excerpt for reading questions
- [x] In learning mode: LLM explanations visible below a question when generated; real-mode sessions never show them (gated server-side)
- [x] Retry: incorrect questions grouped by difficulty band → one learning-mode session per affected band (band's `difficulty` + that band's `questionIds`); multi-band shows the affected bands + counts, started one at a time
- [x] `npm run typecheck`, `npm run lint`, `npm test` (68 tests), `npm run build` all pass

**Implementation notes (SDD Rule 4):** no new endpoint — `GET /api/sessions/:id` per-question
`results` were _additively enriched_ with the review content (text, passage excerpt, options,
`correctLabel`, derived `difficulty`, and the learning-mode-only `explanation`), so review mode
reuses the single endpoint the spec says it consumes. Retry needed **zero** server change: the
existing `POST /api/sessions` already accepts `questionIds` + `difficulty` and enforces the
band-subset constraint (`QUESTIONS_OUT_OF_BAND`). The pure band-grouping (`groupIncorrectByBand`)
is unit-tested; the `vitest` `include` was widened to pick up `client/**/*.test.ts`.

**Specs:**

- `docs/specs/review-mode.md` (implemented)

---

## Milestone 7 — LLM enrichment

**Status:** complete

- [x] `npm run enrich` CLI command generates per-question explanations (why the correct answer is right, why each other option is wrong), in **English**, citing the clue in the passage (reading) / transcript (listening)
- [x] Driven by the **local Claude CLI** (`claude -p --output-format json`), configured via `.env` (`CLAUDE_CLI_BIN`, optional `CLAUDE_CLI_MODEL`; no API key) — replaces the original Claude API / Ollama plan
- [x] Explanations stored in DB (existing `explanations` table, no schema change), idempotently; `--question-id` / `--section` / `--dry-run` flags; per-question skip + continue on CLI/parse failure
- [x] Surface in learning mode immediately after the answer is confirmed (existing wiring), and in **review mode for both learning and real** sessions (real shown only after the exam)
- [x] `npm run typecheck`, `npm run lint`, `npm test` (83 tests), `npm run build` all pass

**Spec revision (SDD Rule 4):** the original M7 spec targeted the Anthropic HTTP API + Ollama and
French-or-English/free-form output; the user redirected it to the **local CLI**, **English +
clue-citing** explanations, and **real-mode explanations in review**. The spec was revised, moved
approved → draft, re-approved, then implemented. The real-mode change **supersedes review-mode
§Behaviour.6** (the M6 learning-only gate on the explanations query was removed). Verified live
against a real `claude` CLI, including the graceful skip when the model declined to emit JSON for a
mismatched seed row.

**Specs:**

- `docs/specs/llm-enrichment.md`

---

## Milestone 8 — Randomized question selection & ordering

**Status:** complete

- [x] Learning mode: present the selected difficulty band's questions in **random order** (all band questions included; only presentation order shuffled, per session)
- [x] Real mode: build a 39-question exam by selecting **one randomly chosen question per occupied sequence position 1–39** — e.g. when five questions exist at position 1, exactly one is shown
- [x] Real mode: selected questions remain in ascending `sequence` order (1 → 39); only _which_ question fills each position is random
- [x] Per-position draw respects the answer key: draws only from keyed candidates; `ANSWER_KEY_MISSING` only when an occupied position has no keyed candidate
- [x] Resolution is per session (re-entering re-draws / re-shuffles); the resolved set + order are stable for that session's lifetime
- [x] Reading questions: passage panel shows the **original passage image on top** with the **OCR'd text directly below it**; served via a new read-only `GET /api/questions/:id/passage-image`, with graceful fallback to text-only when the image is missing on disk
- [x] `npm run typecheck`, `npm run lint`, `npm test` (88 tests), `npm run build`, `npm run test:e2e` (14 tests) all pass

**Implementation notes (SDD Rule 4):** (1) **No schema change.** Rather than persist each session's
randomly-resolved set, real-mode `total`/`pointsPossible` are computed from the section's _distinct_
sequence positions, so multiple imports per position never double-count; review/history already
reconstruct from the per-position `question_results`. Selection/shuffle live in a unit-tested
`server/lib/random.ts` with an injectable RNG. (2) The passage image is served from
`passages.source_file` (absolute, or resolved against `MEDIA_DIR`); the client probes it via the
`<img>` `error` event, so no session-payload change was needed. (3) The dev seeds gained two fixes
surfaced by this work: they now delete `explanations` + `question_results` children before wiping
questions (a pre-existing FK gap from M7/sessions), and `seed:dev` writes real placeholder PNGs to
`MEDIA_DIR`. (4) **e2e isolation:** the suite now creates/migrates/seeds a dedicated `tcf_prep_e2e`
database and launches the app against it — previously it ran against the dev DB, which now holds
real listening imports (several questions per position), making the listening flow non-deterministic.
Stale selectors from the earlier UI redesign (`Start` → `Start session`, `4 / 4 correct`) were also
fixed, and the listening specs made order-tolerant for the new learning shuffle.

**Specs:**

- `docs/specs/quiz-session.md` (implemented — §Question selection and ordering, Behaviour.19–22)
- `docs/specs/reading-quiz-ui.md` (implemented — passage image + OCR text display, Behaviour.3a–3c + `GET /api/questions/:id/passage-image`)

---

## Milestone 9 — SDD retrospective + polish

**Status:** complete

- [x] Complete `docs/sdd-learnings.md` retrospective — added the Milestone 8 entry and a final synthesis answering the four "key questions under evaluation" (rework, the approval gate, traceability comments, solo-vs-team), plus a "where SDD was silent" section on the code-vs-reality boundary
- [x] UI polish pass — tagged the French content (passage, question, options, subtitles) with `lang="fr"` so screen readers pronounce it correctly and hyphenation behaves (non-visual a11y/typography improvement)
- [x] Performance review (DB queries, audio loading):
  - Added explicit indexes on the foreign-key / filter columns Postgres does not auto-index — `question_results(session_id)` + `(question_id)`, `questions(section)` + `(passage_id)`, `options(question_id)`, `transcript_segments(question_id)` (migration `0001_known_war_machine.sql`). `session_id` is the hot one (joined on every completion, history and review read).
  - Collapsed `listSessions` from three queries to one (correct/total/points all derived in memory) — which also **fixed a latent bug**: the "correct" aggregate omitted the `is_correct` filter, so every history row displayed N/N regardless of actual score.
  - Audio loading was already range-aware streaming (`GET /api/questions/:id/audio`, HTTP 206) — reviewed, no change needed.
- [x] Final typecheck + lint + test pass — `npm run typecheck`, `npm run lint`, `npm test` (88), `npm run build`, `npm run test:e2e` (14) all green

**Note (out of scope, flagged):** `listSessions` and `getSession` report `total` as the number of
_recorded answers_, while `completeSession` reports the full exam size — they diverge for an
abandoned/timed-out real session. This is a pre-existing semantic inconsistency in the
progress-tracking spec, not a polish item; left for a future spec revision rather than patched
silently (SDD Rule 4).

**Specs:** none (polish only)

---

## Milestone 10 — Writing section: tasks import + session/UI + LLM evaluation

**Status:** complete

Introduces the third exam section (TCF _Expression écrite_): three free-text tasks, a single
60-minute real-mode limit, an untimed training mode with sample answers + templates + on-request
Claude correction, and — in both modes — a score + feedback produced by the local Claude CLI on
submit. Diverges from reading/listening in three ways the specs make explicit: free-text (not MCQ,
so new tables and a per-task /20 + NCLC scoring shape, not the 699-point map); **request-time**
server-side Claude CLI invocation (which llm-enrichment had scoped out); and an authored task bank
imported from a **directory of markdown files** (no answer key, no OCR/Whisper).

- [x] Writing task import: `npm run import:writing -- --dir <path>` — discovers `*.md` task files
      (front-matter + `## Prompt` / `## Sample answer` / `## Template`), idempotent on
      `(source_file, task_number)`, skip-and-continue on malformed files, `--dry-run`; new `writing_tasks` table
- [x] Writing session: reuse the `sessions` table (`section = 'writing'`); training mode (single task
      or all three, untimed, guidance shown) and real mode (all three, one 60-min budget from
      `exam.config.json`, auto/manual submit); per-task draft autosave + submit; new `writing_responses`
      table; `POST /api/writing/sessions`, `PUT/POST …/responses`, `…/correct`, `…/complete`, `GET …/:id`
- [x] Writing evaluation: request-time local Claude CLI wrapper in `server/services/writingEvaluation.ts`
      (reusing the shared `server/lib/claude-cli.ts` primitives + `server/lib/nclc.ts` for the derived NCLC
      level) — scoring + feedback on submit (both modes), on-request correction (training only, ephemeral);
      graceful `EVALUATION_FAILED` / `CORRECTION_FAILED`; new `writing_evaluations` table
- [x] Writing UI: section entry + mode/task selector, per-task textarea editor with a live word counter
      shown as `current / target` (target = task `minWords`, e.g. `33 / 60`), single 60-min real-mode
      countdown (reused timer), training sample-answer/template panels + "Get correction", per-task +
      overall results (score/20 + NCLC + feedback), read-only review
- [x] History: completed writing attempts retained (responses + per-task scores + feedback persisted)
      and listed in the unified session history with an overall /20 average, routing to a writing review
      view (progress-tracking revision; `GET /api/sessions` extended with `overallScore`/`tasksSubmitted`)
- [x] `npm run typecheck`, `npm run lint`, `npm test` (114), `npm run build` all pass

**Implementation notes (SDD Rule 4):** (1) **Shared CLI primitives** — the enrichment wrapper's pure
helpers (`runClaude`, `extractJsonObject`, `parseCliEnvelope`, `ClaudeError`) were extracted to
`server/lib/claude-cli.ts` so the **request-time** writing evaluation service can reuse them;
`scripts/lib/claude.ts` re-exports them (no behaviour change, existing tests pass). (2) **Deterministic
NCLC** — per the approved revision, the model returns only `score` (0–20) + feedback; the NCLC level is
derived from the score by `server/lib/nclc.ts` and is **not** stored. (3) **Resolved draw persisted** —
unlike the MCQ real-mode draw (recomputed, not stored), a writing session persists one empty
`writing_responses` row per drawn task at creation, so review/scoring always reference the task that was
actually drawn. (4) **Unified history** — `listSessions` now special-cases writing sessions (overall /20
mean + tasks-submitted from `writing_evaluations`); `SessionSummary` gained nullable
`overallScore`/`tasksSubmitted`; the history row routes writing → `/writing/:id`. (5) **Not run live
here:** the DB migration (`0002_clumsy_sister_grimm.sql`) and the live Claude scoring path require the
local Postgres + `claude` CLI (Docker unavailable in this environment), so they were not exercised
end-to-end — but the pure parsers/prompts/derivation are unit-tested and typecheck/lint/build are green.
A sample task bank lives in `samples/writing-tasks/` for `npm run import:writing -- --dir samples/writing-tasks`.

**Specs:**

- `docs/specs/writing-import.md` (implemented)
- `docs/specs/writing-session.md` (implemented)
- `docs/specs/writing-evaluation.md` (implemented)
- `docs/specs/writing-ui.md` (implemented)
- `docs/specs/progress-tracking.md` (revised — §Writing & speaking sessions, draft pending approval; shared with Milestone 11)

---

## Milestone 11 — Speaking section: tasks import + session/UI + Whisper transcription + LLM evaluation

**Status:** implemented

Introduces the fourth exam section (TCF _Expression orale_): three spoken tasks the user answers by
**recording their voice** in the browser. On submit, the audio is saved, **transcribed by the local
Whisper CLI**, and the transcript is scored by the **local Claude CLI** (per-task /20 + NCLC level +
feedback, acting as an _Expression orale_ examiner). Mirrors Writing (Milestone 10) but differs in
three ways: a **JSON** task import (`[{ task, question, answer }]`), **voice recording → Whisper →
Claude** instead of typing, and **per-task TCF-authentic timing** (a prep phase before tasks 2 & 3).
Adds **request-time Whisper transcription** on the server — which, like the listening import, is
Apple-Silicon/macOS-only; the Claude scoring step is platform-agnostic.

- [x] Speaking task import: `npm run import:speaking -- --file <path.json>` — parses a JSON array of
      `{ task, question, answer }`, idempotent on `(source_file, sequence)`, skip-and-continue + `--dry-run`;
      new `speaking_tasks` table
- [x] Speaking session: reuse the `sessions` table (`section = 'speaking'`); training mode (single task
      or all three, untimed, sample answer shown) and real mode (all three, per-task prep + recording limits
      from a new `exam.config.json` `speaking` block, auto-stop recording); per-task recording capture +
      submit; new `speaking_responses` table (audio path + transcript); the `/api/speaking/*` endpoints
      incl. range-aware recording playback
- [x] Speaking evaluation: request-time `server/services/` wrapper reusing `scripts/lib/whisper.ts`
      (transcription, `--language fr`) and `scripts/lib/claude.ts` (scoring + correction) — score + feedback
      on submit (both modes), on-request correction on the transcript (training only, ephemeral); graceful
      `TRANSCRIPTION_FAILED` / `EVALUATION_FAILED` / `CORRECTION_FAILED`; new `speaking_evaluations` table
- [x] Speaking UI: section entry + mode/task selector, in-browser MediaRecorder (mic permission,
      record/stop/playback/re-record), per-task prep→record countdowns in real mode, training sample-answer
  - transcript + "Get correction", per-task + overall results with audio playback (score/20 + NCLC +
    feedback), read-only review
- [x] History: completed speaking attempts retained (recordings + transcripts + per-task scores +
      feedback persisted) and listed in the unified session history with an overall /20 average, for future
      review/analysis (shared progress-tracking revision with Milestone 10)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass

**Specs:**

- `docs/specs/speaking-import.md` (implemented)
- `docs/specs/speaking-session.md` (implemented)
- `docs/specs/speaking-evaluation.md` (implemented)
- `docs/specs/speaking-ui.md` (implemented)
- `docs/specs/progress-tracking.md` (revised — §Writing & speaking sessions, shared with Milestone 10)

---

## Milestone 12 — UI polish: on-screen French keyboard + unified section navigation

**Status:** implemented

Two frontend-only UI improvements (no backend, data-model, or scoring change):

**(a) On-screen virtual keyboard (French accents).** An accent toolbar for the Writing editor for
typing French special characters (é, à, ç, …) by clicking, mirroring the keyboard provided by the real
TCF Canada exam software. Removes the dependency on a French (AZERTY) physical keyboard or OS dead-key
sequences. The already-approved writing-ui spec is unchanged (this augments its editor as the
integration point).

**(b) Unified section navigation.** All four sections (Reading, Listening, Writing, Speaking) become
selectable from both the landing screen and a persistent top menu (quick navigation), replacing the
current Reading/Listening-only picker plus ad-hoc Writing/Speaking nav links.

- [x] Reusable on-screen accent keyboard component matching the real TCF software: the exact 16-key 4×4
      grid (`é è ê ë / à â ù û / ô î ï ç / œ æ « »`) + a `⇧ abc` shift toggle to uppercase, inserted at the
      caret of the focused input (`client/src/features/writing/VirtualKeyboard.tsx`)
- [x] Integrated into the Writing editor next to each task's textarea, in both training and real modes
      (the real TCF software provides it during the timed exam)
- [x] Inserted characters behave like typed input: caret-aware insertion, native undo, and the same
      word-count + autosave paths (via `execCommand('insertText')`); toolbar interoperates with physical-keyboard typing
- [x] Accessible buttons (keyboard-operable, labelled); inserted French text stays within the
      `lang="fr"` textarea content
- [x] Unified navigation: all four sections selectable on the **landing screen** and in a **persistent
      top menu** (`client/src/components/TopNav.tsx`, plus History + Question Bank), consistent order/labels,
      active-section indication, and a graceful empty state for a section with no imported content
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass

**Specs:**

- `docs/specs/virtual-keyboard.md` (implemented)
- `docs/specs/section-navigation.md` (implemented)
- `docs/mockups.md` §19–20 (accent keyboard + unified navigation wireframes)

---

# Cloudflare hosting initiative (Milestones 13–16)

Milestones 13–16 add the ability to **host the app online on Cloudflare's free tier** while keeping the
**full local experience** working on macOS (app + import scripts) and Windows (app; scripts optional).

Two facts drive the design: (1) all data access already goes through Drizzle and the services are
framework-agnostic, so the database and web-framework swaps touch a small, isolated surface; (2)
Cloudflare's serverless free tier **cannot run the local CLI binaries** (Tesseract OCR, Whisper, Claude
CLI) nor native `pg`/`better-sqlite3`. Decisions locked with the user: the online instance is
**practice-only** (pre-imported content + all four sections playable; imports, AI scoring, transcription,
and enrichment stay local-only — online Writing/Speaking show sample answers, no AI score); **single
user** (Cloudflare Access gate, no per-user data model); the backend is **unified on Hono** (one codebase
runs on Node locally and on Cloudflare Workers). Unifying insight: local SQLite and Cloudflare **D1 are
both SQLite**, so one Drizzle `sqlite-core` schema serves both runtimes.

Target topology: a **single Cloudflare Worker** serving the built client (Workers Static Assets) + the
Hono `/api/*` routes, bound to **D1** (database) and **R2** (media), gated by **Cloudflare Access**.
Local dev is unchanged: Vite proxies `/api` to Hono-on-Node.

---

## Milestone 13 — Database migration to SQLite (local)

**Status:** complete

Move persistence from PostgreSQL to SQLite with **no observable behaviour change**, as the foundation for
Cloudflare D1 (itself SQLite) and a local-dev simplification (no Docker/Postgres → the app + DB also run
on **Windows**). Because all DB access is Drizzle, the change is confined to the schema definition,
client, config, generated migrations, and a few tooling scripts.

- [x] Rewrite `server/db/schema.ts` from `drizzle-orm/pg-core` to `drizzle-orm/sqlite-core`, preserving
      every table/column/constraint/index (`serial`→`integer autoincrement`, `boolean`→`integer {mode:
'boolean'}`, `timestamp`→`integer {mode: 'timestamp'}` to keep JS `Date` semantics)
- [x] Swap the DB client in `server/db/index.ts` to libSQL (`@libsql/client` + `drizzle-orm/libsql`),
      same exported `db` symbol, FK enforcement on; update `server/db/migrate.ts`
- [x] `drizzle.config.ts` → `dialect: 'sqlite'`; delete the PostgreSQL migrations and regenerate one
      clean SQLite baseline (`0000_living_chimera.sql` — every CHECK/UNIQUE/index/FK round-tripped)
- [x] `server/config/env.ts` + `.env.example` → `file:` `DATABASE_URL`; remove `db:up`/`db:down` +
      `docker-compose.yml`; add `@libsql/client`; move `pg`/`@types/pg` to devDependencies (kept only for
      the migration script below)
- [x] One-time data-migration script `npm run db:migrate-from-postgres -- --from <PG_DATABASE_URL>`:
      copy every table from an existing PostgreSQL dev DB into SQLite, preserving primary-key ids and
      foreign-key links (FK dependency order), converting `boolean`/`timestamptz`; `--dry-run` + per-table
      row-count summary
- [x] Verify seeds + `npm test` (136) + `npm run test:e2e` (15) pass on SQLite; app + DB run on Windows
      with no Docker

**Implementation notes (SDD Rule 4):** (1) **cwd-relative `file:` paths.** libSQL resolves a relative
`file:` URL against `process.cwd()`, which differs between the server workspace (`server/`) and the
root-run tooling (migrate/seed/e2e) — they would otherwise open _different_ DB files. `getDatabaseUrl()`
now anchors a relative `file:` path to the repo root so all entry points agree; a new
`server/db/sqlite-path.ts` `ensureSqliteDir()` creates the parent dir libSQL won't. Not anticipated by
the spec (Postgres URLs are host-based, cwd-independent). (2) **`pool` → `client`.** `pg.Pool.end()` has
no libSQL analogue, so the `db/index.ts` `pool` export became `client` and the 7 CLI/seed scripts now
call `client.close()` (within the spec's "adjust seed/CLI scripts if required"). (3) **e2e reset is
best-effort.** On Windows the previous run's server / an AV scan can hold the e2e `.db` handle for
seconds; the delete is best-effort and falls back to idempotent migrate + seeds — matching the old
Postgres flow, which never dropped the DB either. (4) **Not exercised live:** the source Postgres dev DB
was empty (0 rows in every table), so the data-copy _write_ path had nothing to copy; the dry-run
confirmed all 14 tables are read in FK order, and the verbatim type conversion is straightforward.

**Specs:**

- `docs/specs/database-sqlite.md` (implemented)

---

## Milestone 14 — Portable server runtime (Express → Hono)

**Status:** complete

Replace Express with **Hono** so one backend codebase runs on Node locally (via `@hono/node-server`) and
on Cloudflare Workers later, with no API/behaviour change locally. Introduces three small abstractions
that let the same route code bind to Node resources or Worker resources: a **DB factory**, a
**`MediaStore` interface** (range read / put / exists), and a **capabilities flag**
(`GET /api/health` → `{ aiScoring, transcription, imports }`, all `true` on Node).

- [x] Translate `server/index.ts` + the five route modules to Hono; services in `server/services/`
      DB-injected; envelope (`server/lib/envelope.ts`) reused; replace `multer` with Hono `parseBody`
- [x] DB factory (`createDb()`): libSQL on Node (D1 on Workers in M15); services receive the DB instead
      of importing a singleton (`server/db/index.ts` singleton kept only for Node-only `scripts/`)
- [x] `MediaStore` interface with a Node/filesystem implementation (`NodeMediaStore`) wrapping today's
      range-aware streaming (R2 implementation in M15)
- [x] Structure the app as a **portable core** (`server/app.ts`) + a **Node-only extension**
      (`server/routes/node-routes.ts` + `services/{writing,speaking}-node.ts`) for the CLI-backed routes
      (imports, AI scoring submit, correction, transcription, recording upload), so
      `node:child_process` / `node:fs` never enter the future Worker bundle
- [x] **PostgreSQL cleanup** (data already migrated in M13): deleted `scripts/migrate-pg-to-sqlite.ts` +
      the `db:migrate-from-postgres` script, dropped `pg`/`@types/pg`, and stripped residual Postgres
      references from code/config (the only remaining `pg` is `drizzle-orm`'s optional peer — see the
      spec's Rule-4 note)
- [x] Dev DX unchanged (`npm run dev`, Vite proxy); typecheck / lint / test / build pass (e2e run by the
      orchestrator)

**Implementation notes:**

- New files: `server/runtime/{capabilities,media-store,node-media-store}.ts`, `server/db/factory.ts`,
  `server/app.ts`, `server/lib/range.ts`, `server/routes/{app-vars,node-routes}.ts`,
  `server/services/{writing-node,speaking-node}.ts`, `server/app.test.ts`.
- The speaking recording-upload route stays in the Node-only extension (not the core) because
  byte-identical behaviour needs upload-time Whisper transcription (Rule-4 note in the spec).
- Speaking recordings now persist a **relative** MediaStore key (was absolute) — portable + R2-ready.
- 137 unit/render tests pass (incl. `parseRange` from its new `server/lib/range.ts` home + a new
  portable-core construction smoke test).

**Specs:**

- `docs/specs/server-runtime.md` (implemented)

---

## Milestone 15 — Cloudflare deployment (Worker + Assets + D1 + R2 + Access)

**Status:** ready for development (spec approved)

Establish the running, access-gated cloud runtime: a single Worker serving the SPA (Workers Static
Assets) + the Hono portable core, bound to **D1** and **R2**, gated by **Cloudflare Access** (single
user, no app auth code). Online capabilities are all-`false` (practice-only); the CLI-backed routes are
never mounted.

- [ ] `wrangler.toml`: one Worker (`main: server/worker.ts`), `[assets]` = `client/dist` (SPA fallback),
      `DB` D1 binding, `MEDIA` R2 binding
- [ ] `server/worker.ts`: import the portable core, build DB from the `DB` binding, wire the **R2
      `MediaStore`**, set capabilities all-`false`
- [ ] Apply the M13 SQLite baseline to D1 (`wrangler d1 migrations apply`); range/206 media streaming
      from R2; `/api/*` routing takes precedence over static assets
- [ ] Cloudflare Access in front of the Worker (documented shared-secret middleware fallback)
- [ ] Build + `wrangler deploy` scripts; optional `wrangler dev` parity; CLAUDE.md deployment runbook

**Specs:**

- `docs/specs/cloud-deployment.md` (approved)

---

## Milestone 16 — Content seeding + online practice mode + client gating

**Status:** ready for development (spec approved)

Make the deployed instance usable: push locally-imported content to D1/R2 (**import locally → push to
cloud**) and gate the client UI on `capabilities` so the practice-only online experience has no broken
buttons. Defines the online behaviour of Writing/Speaking when AI scoring is unavailable (sample answers,
no score).

- [ ] `npm run deploy:content` (local): reuse the **export** service to load D1 (via the portable import
      endpoint, idempotent on the natural keys) and upload referenced media (MP3s, passage images) to R2
      keyed to `file_path`/`source_file`
- [ ] Online practice-mode behaviour (gated by `aiScoring=false`/`transcription=false`): Writing submit
      locks the response without scoring and shows the sample answer/template; Speaking = record + playback +
      sample answer, no transcript/score; correction unavailable online
- [ ] Client capability-gating: `client/src/lib/api.ts` `fetchCapabilities()`; hide AI-score/feedback,
      "Get correction", and import affordances when off (fail safe to most-restrictive on fetch error)
- [ ] Local runtime (all capabilities `true`) behaves exactly as before — no regression in the existing
      suites
- [ ] History shows online-completed sessions without a fabricated /20 (missing evaluation = unscored)

**Specs:**

- `docs/specs/content-deploy.md` (approved)
- `docs/specs/writing-evaluation.md` / `docs/specs/speaking-evaluation.md` / `docs/specs/progress-tracking.md`
  (to be annotated: AI scoring is a local/full-runtime capability; online sessions are unscored practice)

---

## Milestone 17 — Selectable LLM provider (local CLI default + Claude HTTP API)

**Status:** draft (spec written, awaiting approval)

Decouple LLM access from the local `claude` binary. Today every Claude call goes through one
synchronous primitive (`runClaude`, `server/lib/claude-cli.ts`). Add a configurable **provider seam**
with two backends — the existing **local CLI (default, zero-config)** and a new **Claude HTTP API**
(Messages API via native `fetch`, no new dependency) — chosen from `.env` with explicit per-provider
model selection. The same prompts and JSON contracts are reused unchanged; only the transport and the
configured model differ. Because the API path needs no local binary, it also lets the deployed Worker
score Writing/Speaking online when an API key is bound.

- [ ] Provider seam in `server/lib/` (`complete(prompt, opts) => Promise<string>`): a CLI provider
      wrapping `runClaude`, an API provider calling `POST {baseUrl}/v1/messages` via `fetch`, and a
      config-driven factory defaulting to `cli`
- [ ] Config from `.env`: `LLM_PROVIDER` (`cli` default | `api`); CLI keeps `CLAUDE_CLI_BIN` /
      `CLAUDE_CLI_MODEL`; API adds `ANTHROPIC_API_KEY` (required), `CLAUDE_API_MODEL`, optional
      `CLAUDE_API_BASE_URL` / `CLAUDE_API_MAX_TOKENS`
- [ ] Route all three LLM call sites through the seam (Writing scoring + correction, Speaking scoring +
      correction, reading/listening enrichment); the `*WithClaude` / `generateExplanation` functions
      become async, callers `await`; prompt builders + JSON parsers reused verbatim
- [ ] Provenance: `generated_by` records the backend + model (`claude-cli`, `claude-cli/<model>`,
      `claude-api/<model>`); failures still surface as `ClaudeError` → `EVALUATION_FAILED` /
      `CORRECTION_FAILED` (no new error codes)
- [ ] Worker: when `ANTHROPIC_API_KEY` is bound, use the API provider, report `capabilities.aiScoring:
    true`, and mount the writing/speaking scoring + correction routes; transcription/imports/enrichment
      stay unavailable on the Worker (`transcription: false`)
- [ ] Unit tests: CLI passthrough unchanged; API provider driven by a stubbed `fetch` (success +
      failure); provenance strings; Worker health capability gated on the key

At implementation time this revises the writing-evaluation / speaking-evaluation / llm-enrichment /
cloud-deployment specs (provider seam supersedes their CLI-only invocation sections; Worker `aiScoring`
becomes conditional on a bound API key).

**Specs:**

- `docs/specs/llm-provider.md` (draft)
