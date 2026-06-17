# Spec: Writing Evaluation & Correction

## Status
implemented

> Milestone 10. The local-Claude-CLI layer for the Writing section: scoring + feedback on submit
> (both modes) and on-request correction (training only). Consumed by the writing-session endpoints
> (`/submit`, `/correct`, `/complete`) and surfaced by the writing-ui spec.

## Goal
Evaluate a user's free-text writing response with the **local Claude CLI** and return a **score
(/20)**, an **NCLC level derived deterministically from that score**, and **structured written
feedback** (strengths, errors, suggested improvements). The model produces only the numeric score and
the feedback; the NCLC level is **computed by the system from the score** via a fixed map (it is not
the model's guess). Evaluation runs **on submit**, in **both** training and real modes, and is
persisted. Separately, in **training mode only**, the user can **request a correction** for the
current draft — a corrected version of the text plus improvement suggestions — returned live.

This introduces a capability the existing `llm-enrichment` spec explicitly excluded: **request-time**
(synchronous, during a live session) invocation of the Claude CLI from the **server**. It reuses the
same configuration (`.env`: `CLAUDE_CLI_BIN`, `CLAUDE_CLI_MODEL`; no API key) and the pure
prompt-build/JSON-parse helper pattern established in `scripts/lib/claude.ts`.

## Scope
- In scope:
  - A `server/services/` wrapper that invokes the local `claude` CLI non-interactively at request
    time and parses a JSON object from its output (tolerating prose/code-fence wrapping, like
    enrichment).
  - **Scoring on submit** (both modes): given the task prompt and the user's response, the model
    produces `score` (integer 0–20) and `feedback` (strengths / errors / improvements), persisted in
    `writing_evaluations`. The **NCLC `level` is derived deterministically from `score`** by a shared
    pure helper (a fixed score→NCLC map) and is **not** stored — it is computed on read wherever
    displayed.
  - **On-request correction** (training only): given the current draft, produce a corrected version
    of the text and a list of improvement suggestions, returned live and **not persisted**.
  - Graceful per-call failure: a non-zero CLI exit or unparseable output yields a typed error
    envelope (`EVALUATION_FAILED` / `CORRECTION_FAILED`) — the session is never crashed and no
    partial/invalid row is written.
  - Reading config from `.env` exactly as the enrichment command does.
- Out of scope:
  - Batch/offline scoring (this is request-time only; there is no `npm run` equivalent).
  - MCQ scoring or the 699-point map (writing does not use them).
  - Asking the model to assign the NCLC level (it is derived from the score instead — see §Score → NCLC).
  - The editor/results UI (writing-ui spec) and the session lifecycle (writing-session spec).

## Behaviour

### Configuration & invocation
1. The service reads configuration from `.env`:
   - `CLAUDE_CLI_BIN`: the Claude CLI binary name/path (default `claude`).
   - `CLAUDE_CLI_MODEL` (optional): passed as `--model`; when unset the CLI default model is used.
   No API key is read — the local CLI manages its own authentication.
2. The service invokes the CLI non-interactively (`claude -p <prompt>`, plus `--model` when
   configured), captures stdout, and parses the **first JSON object** out of the response (tolerating
   surrounding prose or a code fence), mirroring the enrichment parser. Invocation happens
   **per request**, on the server, within the HTTP request lifecycle.

### Scoring (on submit, both modes)
3. When a task is submitted (`POST …/responses/:taskNumber/submit`, see writing-session), the service
   builds an English prompt containing: the task `prompt`/instructions, the task's word-count
   guidance (`min_words`/`max_words`), and the user's response text. It instructs the model to act as
   a TCF Canada *Expression écrite* evaluator and return a JSON object with:
   - `score`: integer 0–20 for this task.
   - `strengths`: what the response does well.
   - `errors`: notable language/structure errors (grammar, vocabulary, register, coherence).
   - `improvements`: concrete suggestions to raise the score.
   The model is **not** asked for the NCLC level.
4. The parsed result (score + feedback) is persisted in `writing_evaluations`, linked to the response
   (one row per response; resubmitting **replaces** the prior row), with `generated_by` recording
   `claude-cli` (plus `/model` when pinned) and `generated_at` set. The NCLC level is not stored.
5. The submit endpoint returns `score`, the **derived** `level` (see §Score → NCLC), and the structured
   `feedback` to the client.
6. On a CLI failure (non-zero exit) or output with no parseable JSON object, the service logs the
   error (including captured stderr), writes **no** evaluation row, and the endpoint returns
   `EVALUATION_FAILED`. The user can retry by resubmitting.

### Score → NCLC (deterministic)
6a. The NCLC level is a pure, deterministic function of the per-task `score` (0–20), computed by a
    shared helper (e.g. `server/lib/nclc.ts`) reused by writing and speaking — never produced by the
    model and never persisted. The default map (monotonic; tunable — see Open questions):

    | Score /20 | NCLC level |
    |---|---|
    | 18–20 | NCLC 10+ |
    | 16–17 | NCLC 9  |
    | 14–15 | NCLC 8  |
    | 12–13 | NCLC 7  |
    | 10–11 | NCLC 6  |
    | 8–9   | NCLC 5  |
    | 6–7   | NCLC 4  |
    | 4–5   | NCLC 3  |
    | 0–3   | NCLC 1–2 |

6b. An **overall** NCLC (for the results/history summary) is derived the same way from the overall
    score (the rounded mean of the per-task scores), using the identical map.

### Correction (on request, training only)
7. When the user requests a correction (`POST …/correct/:taskNumber`, training mode only), the service
   builds a prompt with the task `prompt` and the user's current draft, instructing the model to
   return a JSON object with:
   - `correctedText`: the draft rewritten with errors fixed, keeping the user's intent.
   - `suggestions`: a list of specific improvement notes (what was changed and why / what to try).
8. The result is returned live to the client and is **not persisted** (it is an iterative drafting
   aid; the user may request it repeatedly as the draft evolves). See Open questions.
9. A real-mode session calling this endpoint receives `MODE_NOT_ALLOWED` (enforced in
   writing-session); the evaluation service itself is mode-agnostic.
10. Correction failures behave like scoring failures: logged with stderr, no state change, endpoint
    returns `CORRECTION_FAILED`.

## Data model changes
```
-- spec: docs/specs/writing-evaluation.md §Data model changes
writing_evaluations
  id            serial primary key
  response_id   integer not null unique references writing_responses(id)  -- one evaluation per response
  score         integer not null            -- 0..20 for the task (model-produced)
  strengths     text not null
  errors        text not null
  improvements  text not null
  generated_by  text not null               -- 'claude-cli' or 'claude-cli/<model>'
  generated_at  timestamptz not null default now()

  check (score between 0 and 20)
  -- NCLC `level` is NOT stored: it is derived deterministically from `score` on read (§Score → NCLC).
```
On-request corrections are **not** stored — no table for them. Resubmitting a response replaces its
`writing_evaluations` row (delete-and-insert or upsert on the unique `response_id`).

## API contract
This service has no routes of its own; it is invoked by the writing-session endpoints. The shapes it
produces:

```typescript
type WritingFeedback = {
  strengths: string      // what the response does well
  errors: string         // notable grammar / vocabulary / register / coherence errors
  improvements: string   // concrete suggestions to raise the score
}

// Returned by POST /api/writing/sessions/:id/responses/:taskNumber/submit
type WritingEvaluation = {
  score: number          // 0–20 (model-produced, persisted)
  level: string          // NCLC, DERIVED from score via §Score → NCLC (not stored, not model-produced)
  feedback: WritingFeedback
}

// Returned by POST /api/writing/sessions/:id/correct/:taskNumber (training only; not persisted)
type WritingCorrection = {
  correctedText: string  // the draft rewritten with errors fixed
  suggestions: string[]  // specific improvement notes
}
```
Error codes surfaced by the consuming endpoints: `EVALUATION_FAILED` (submit), `CORRECTION_FAILED`
(correct), `MODE_NOT_ALLOWED` (correct requested on a real-mode session).

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The evaluation service reads `CLAUDE_CLI_BIN` / `CLAUDE_CLI_MODEL` from `.env`, requires no API key, and a missing binary produces a descriptive error. (Behaviour.1)
- [ ] The service invokes the local `claude` CLI at request time and parses the first JSON object from its output, tolerating prose/code-fence wrapping. (Behaviour.2)
- [ ] Submitting a task: the model returns `score` (0–20) + `feedback` (strengths/errors/improvements), persisted in one `writing_evaluations` row (no `level` column); the response includes a `level` **derived from the score** via the §Score → NCLC map. (Behaviour.3, 4, 5, 6a; Data model)
- [ ] The `level` is a pure deterministic function of `score` (same input → same level), computed by a shared helper, identical for writing and speaking, and never requested from the model. (Behaviour.6a)
- [ ] Resubmitting the same response replaces its prior evaluation (unique on `response_id`). (Behaviour.4; Data model)
- [ ] A CLI failure or unparseable output on submit writes no row and returns `EVALUATION_FAILED`; the session continues and the user can resubmit. (Behaviour.6)
- [ ] A training-mode correction request returns `correctedText` + `suggestions` live and persists nothing. (Behaviour.7, 8; API contract)
- [ ] A correction requested on a real-mode session returns `MODE_NOT_ALLOWED`; a CLI/parse failure returns `CORRECTION_FAILED` with no state change. (Behaviour.9, 10)
- [ ] The CLI wrapper reuses the shared prompt-build/JSON-parse helpers (no duplicated parser); helper logic is pure and unit-tested. (Scope)

## Open questions
- **Correction persistence.** Default: corrections are ephemeral (not stored), so review mode shows
  only the submitted response + its score/feedback, not past corrections. If review should replay
  corrections, add a `writing_corrections` table (multiple per response). Confirm.
- ~~**NCLC mapping fidelity.**~~ **Resolved 2026-06-17:** the level is **derived deterministically from
  `score`** via the fixed §Score → NCLC map (a shared pure helper), not produced by the model. The
  exact band boundaries in that table are provisional defaults — confirm against the official
  TCF/NCLC correspondence, and decide whether the map should live in code (`server/lib/nclc.ts`) or be
  made tunable via `exam.config.json`.
- **Prompt language of feedback.** Feedback is requested in English (consistent with llm-enrichment),
  while the response itself is French. Confirm English feedback is desired (vs. French or bilingual).
- **Shared wrapper location.** The pure parse/extract helpers currently live in
  `scripts/lib/claude.ts`. Implementation should refactor them into a module importable by both the
  script and the new `server/services/` wrapper to avoid duplication (CLAUDE.md: CLI calls wrapped in
  `scripts/` or `server/services/`). The Claude CLI is platform-agnostic, so this server-side
  invocation is **not** subject to the Apple-Silicon constraint that applies to Whisper/Tesseract.

## Revision history
- 2026-06-17: Initial draft (Milestone 10).
- 2026-06-17: NCLC `level` is now **derived deterministically from `score`** (added §Score → NCLC map +
  a shared `server/lib/nclc.ts` helper) instead of being produced by the model; dropped the stored
  `level` column (derived on read, echoing the M8 "don't persist derived data" decision). Resolved the
  NCLC-fidelity open question.
- 2026-06-17: Status moved draft → approved.
