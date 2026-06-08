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
**Status:** not started

- [ ] Audio import script: `npm run transcribe -- --dir <path>` — discovers one results PDF + MP3s in directory, parses questions/options/correct answers from PDF, transcribes via Whisper, persists questions + segments
- [ ] Listening player: audio playback with phrase-level subtitle overlay and moving highlight marker
- [ ] Clicking a subtitle segment seeks audio to that point
- [ ] Listening quiz UI: player + 4-option multiple-choice, learning and real modes (35 min / 39 questions)

**Specs:**
- `docs/specs/listening-import.md`
- `docs/specs/listening-player.md`
- `docs/specs/listening-quiz-ui.md`

---

## Milestone 4 — Progress tracking + session history
**Status:** not started

- [ ] Session model: type (reading | listening), mode (learning | real), started/completed timestamps
- [ ] Per-question result: question id, chosen answer, correct/incorrect
- [ ] Score calculation and display at session end
- [ ] Real mode: elapsed time tracked and stored
- [ ] Session history list page

**Specs:**
- `docs/specs/progress-tracking.md`

---

## Milestone 5 — Review mode
**Status:** not started

- [ ] After a session ends, user can enter review mode
- [ ] Shows each question with user's answer, correct answer highlighted
- [ ] In learning mode: LLM explanations visible (if generated)
- [ ] Retry: start a new session with only the questions answered incorrectly

**Specs:**
- `docs/specs/review-mode.md`

---

## Milestone 6 — LLM enrichment
**Status:** not started

- [ ] Standalone CLI script to generate per-question explanations (why correct answer is right, why others are wrong)
- [ ] Supports Claude API and Ollama via `.env` configuration (`LLM_PROVIDER`, `LLM_MODEL`, `ANTHROPIC_API_KEY` / `OLLAMA_BASE_URL`)
- [ ] Explanations stored in DB, linked to question
- [ ] Explanations surface in learning mode after user submits a final answer

**Specs:**
- `docs/specs/llm-enrichment.md`

---

## Milestone 7 — SDD retrospective + polish
**Status:** not started

- [ ] Complete `docs/sdd-learnings.md` retrospective
- [ ] UI polish pass
- [ ] Performance review (DB queries, audio loading)
- [ ] Final typecheck + lint + test pass

**Specs:** none (polish only)
