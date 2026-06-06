# Milestones

## Milestone 1 — Project scaffold + DB setup
**Status:** not started

- [ ] Initialise monorepo: `client/` (React + Vite + Tailwind + TS), `server/` (Express + TS)
- [ ] Configure Drizzle ORM with PostgreSQL (`DATABASE_URL` in `.env`)
- [ ] Define initial schema (passages, questions, options, audio_files, transcript_segments, sessions, question_results, explanations)
- [ ] Run first migration
- [ ] `npm run dev` starts both client and server concurrently
- [ ] `npm run typecheck`, `npm run lint` pass clean

**Specs:** none (scaffold only)

---

## Milestone 2 — Reading section: import pipeline + quiz UI
**Status:** not started

- [ ] OCR import script: `npm run ocr -- --dir <path>` — discovers one HTML + PNGs in directory, OCRs passages, persists questions
- [ ] Reading quiz UI: passage display, 4-option multiple-choice, submit answer
- [ ] Learning mode: immediate feedback after each answer
- [ ] Real mode: timed session (60 min / 39 questions), no feedback during session

**Specs:**
- `docs/specs/reading-import.md`
- `docs/specs/quiz-session.md`
- `docs/specs/reading-quiz-ui.md`

---

## Milestone 3 — Listening section: import pipeline + player + quiz UI
**Status:** not started

- [ ] Audio import script: `npm run transcribe -- --dir <path>` — discovers one HTML + MP3s in directory, transcribes via Whisper, persists questions + segments
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
