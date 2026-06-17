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
`results` were *additively enriched* with the review content (text, passage excerpt, options,
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
- [x] Real mode: selected questions remain in ascending `sequence` order (1 → 39); only *which* question fills each position is random
- [x] Per-position draw respects the answer key: draws only from keyed candidates; `ANSWER_KEY_MISSING` only when an occupied position has no keyed candidate
- [x] Resolution is per session (re-entering re-draws / re-shuffles); the resolved set + order are stable for that session's lifetime
- [x] Reading questions: passage panel shows the **original passage image on top** with the **OCR'd text directly below it**; served via a new read-only `GET /api/questions/:id/passage-image`, with graceful fallback to text-only when the image is missing on disk
- [x] `npm run typecheck`, `npm run lint`, `npm test` (88 tests), `npm run build`, `npm run test:e2e` (14 tests) all pass

**Implementation notes (SDD Rule 4):** (1) **No schema change.** Rather than persist each session's
randomly-resolved set, real-mode `total`/`pointsPossible` are computed from the section's *distinct*
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
*recorded answers*, while `completeSession` reports the full exam size — they diverge for an
abandoned/timed-out real session. This is a pre-existing semantic inconsistency in the
progress-tracking spec, not a polish item; left for a future spec revision rather than patched
silently (SDD Rule 4).

**Specs:** none (polish only)

---

## Milestone 10 — Writing section: tasks import + session/UI + LLM evaluation
**Status:** approved

Introduces the third exam section (TCF *Expression écrite*): three free-text tasks, a single
60-minute real-mode limit, an untimed training mode with sample answers + templates + on-request
Claude correction, and — in both modes — a score + feedback produced by the local Claude CLI on
submit. Diverges from reading/listening in three ways the specs make explicit: free-text (not MCQ,
so new tables and a per-task /20 + NCLC scoring shape, not the 699-point map); **request-time**
server-side Claude CLI invocation (which llm-enrichment had scoped out); and an authored task bank
imported from a **directory of markdown files** (no answer key, no OCR/Whisper).

- [ ] Writing task import: `npm run import:writing -- --dir <path>` — discovers `*.md` task files
  (front-matter + `## Prompt` / `## Sample answer` / `## Template`), idempotent on
  `(source_file, task_number)`, skip-and-continue on malformed files, `--dry-run`; new `writing_tasks` table
- [ ] Writing session: reuse the `sessions` table (`section = 'writing'`); training mode (single task
  or all three, untimed, guidance shown) and real mode (all three, one 60-min budget from
  `exam.config.json`, auto/manual submit); per-task draft autosave + submit; new `writing_responses`
  table; `POST /api/writing/sessions`, `PUT/POST …/responses`, `…/correct`, `…/complete`, `GET …/:id`
- [ ] Writing evaluation: request-time local Claude CLI wrapper in `server/services/` (reusing the
  `scripts/lib/claude.ts` prompt/parse helpers) — scoring + feedback on submit (both modes), on-request
  correction (training only, ephemeral); graceful per-call failure; new `writing_evaluations` table
- [ ] Writing UI: section entry + mode/task selector, per-task textarea editor with live word counter,
  single 60-min real-mode countdown (reused timer), training sample-answer/template panels + "Get
  correction", per-task + overall results (score/20 + NCLC + feedback), read-only review
- [ ] History: completed writing attempts retained (responses + per-task scores + feedback persisted)
  and listed in the unified session history with an overall /20 average, for future review/analysis
  (progress-tracking revision)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass

**Specs:**
- `docs/specs/writing-import.md` (approved)
- `docs/specs/writing-session.md` (approved)
- `docs/specs/writing-evaluation.md` (approved)
- `docs/specs/writing-ui.md` (approved)
- `docs/specs/progress-tracking.md` (revised — §Writing & speaking sessions, draft pending approval; shared with Milestone 11)

---

## Milestone 11 — Speaking section: tasks import + session/UI + Whisper transcription + LLM evaluation
**Status:** draft

Introduces the fourth exam section (TCF *Expression orale*): three spoken tasks the user answers by
**recording their voice** in the browser. On submit, the audio is saved, **transcribed by the local
Whisper CLI**, and the transcript is scored by the **local Claude CLI** (per-task /20 + NCLC level +
feedback, acting as an *Expression orale* examiner). Mirrors Writing (Milestone 10) but differs in
three ways: a **JSON** task import (`[{ task, question, answer }]`), **voice recording → Whisper →
Claude** instead of typing, and **per-task TCF-authentic timing** (a prep phase before tasks 2 & 3).
Adds **request-time Whisper transcription** on the server — which, like the listening import, is
Apple-Silicon/macOS-only; the Claude scoring step is platform-agnostic.

- [ ] Speaking task import: `npm run import:speaking -- --file <path.json>` — parses a JSON array of
  `{ task, question, answer }`, idempotent on `(source_file, sequence)`, skip-and-continue + `--dry-run`;
  new `speaking_tasks` table
- [ ] Speaking session: reuse the `sessions` table (`section = 'speaking'`); training mode (single task
  or all three, untimed, sample answer shown) and real mode (all three, per-task prep + recording limits
  from a new `exam.config.json` `speaking` block, auto-stop recording); per-task recording capture +
  submit; new `speaking_responses` table (audio path + transcript); the `/api/speaking/*` endpoints
  incl. range-aware recording playback
- [ ] Speaking evaluation: request-time `server/services/` wrapper reusing `scripts/lib/whisper.ts`
  (transcription, `--language fr`) and `scripts/lib/claude.ts` (scoring + correction) — score + feedback
  on submit (both modes), on-request correction on the transcript (training only, ephemeral); graceful
  `TRANSCRIPTION_FAILED` / `EVALUATION_FAILED` / `CORRECTION_FAILED`; new `speaking_evaluations` table
- [ ] Speaking UI: section entry + mode/task selector, in-browser MediaRecorder (mic permission,
  record/stop/playback/re-record), per-task prep→record countdowns in real mode, training sample-answer
  + transcript + "Get correction", per-task + overall results with audio playback (score/20 + NCLC +
  feedback), read-only review
- [ ] History: completed speaking attempts retained (recordings + transcripts + per-task scores +
  feedback persisted) and listed in the unified session history with an overall /20 average, for future
  review/analysis (shared progress-tracking revision with Milestone 10)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass

**Specs:**
- `docs/specs/speaking-import.md` (draft)
- `docs/specs/speaking-session.md` (draft)
- `docs/specs/speaking-evaluation.md` (draft)
- `docs/specs/speaking-ui.md` (draft)
- `docs/specs/progress-tracking.md` (revised — §Writing & speaking sessions, shared with Milestone 10)
