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
**Status:** not started

- [ ] After a session ends, user can enter review mode
- [ ] Shows each question with user's answer, correct answer highlighted
- [ ] In learning mode: LLM explanations visible (if generated)
- [ ] Retry: start a new session with only the questions answered incorrectly

**Specs:**
- `docs/specs/review-mode.md`

---

## Milestone 7 — LLM enrichment
**Status:** not started

- [ ] Standalone CLI script to generate per-question explanations (why correct answer is right, why others are wrong)
- [ ] Supports Claude API and Ollama via `.env` configuration (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY` / `OLLAMA_BASE_URL`)
- [ ] Explanations stored in DB, linked to question
- [ ] Explanations surface in learning mode after user submits a final answer

**Specs:**
- `docs/specs/llm-enrichment.md`

---

## Milestone 8 — SDD retrospective + polish
**Status:** not started

- [ ] Complete `docs/sdd-learnings.md` retrospective
- [ ] UI polish pass
- [ ] Performance review (DB queries, audio loading)
- [ ] Final typecheck + lint + test pass

**Specs:** none (polish only)
