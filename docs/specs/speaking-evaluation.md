# Spec: Speaking Transcription & Evaluation

## Status
draft

> Milestone 11. The request-time CLI layer for the Speaking section: **Whisper transcription** of a
> recording, **Claude scoring + feedback** on submit (both modes), and **on-request correction**
> (training only). Consumed by the speaking-session endpoints (`…/responses`, `…/submit`,
> `…/correct`, `…/complete`) and surfaced by the speaking-ui spec.

## Goal
Turn a user's voice recording into a TCF *Expression orale* evaluation. On upload, the audio is
**transcribed by the local Whisper CLI** (French). On submit, the transcript is sent to the **local
Claude CLI**, which acts as a TCF speaking examiner and returns a **score (/20)** and **structured
feedback** (strengths, errors, improvements) — persisted. The **NCLC level is derived
deterministically from the score** by the system (the same shared map as writing-evaluation), not
produced by the model. Separately, in **training mode only**, the user can request a **correction** of
the transcript (a corrected/improved version plus suggestions), returned live.

This extends the request-time CLI pattern introduced for Writing with a **request-time Whisper**
step. Whisper is **Apple-Silicon/macOS-only** (CLAUDE.md), so the transcription path inherits that
constraint — exactly like the listening import. The Claude scoring/correction step is
platform-agnostic. Configuration follows the existing conventions (`.env`: `CLAUDE_CLI_BIN`,
`CLAUDE_CLI_MODEL`, `WHISPER_CMD`, `WHISPER_MODEL`; no API key).

## Scope
- In scope:
  - A `server/services/` wrapper that, at request time: (a) saves an uploaded recording under
    `MEDIA_DIR` and **transcribes** it via the **same Whisper CLI wrapper the listening import uses** —
    `scripts/lib/whisper.ts` (`runWhisper`, `mlx_whisper`, `--language fr`, `WHISPER_CMD`/`WHISPER_MODEL`
    overrides), exactly as `npm run transcribe` does — with no second/alternate transcription path;
    (b) **scores** a transcript via the local `claude` CLI; (c) produces an on-request **correction** of
    a transcript.
  - **Transcription on upload:** run Whisper (`--language fr`), concatenate its segments into a single
    transcript string stored on the `speaking_responses` row.
  - **Scoring on submit** (both modes): given the task `question` and the transcript, the model
    produces `score` (integer 0–20) and `feedback` (strengths / errors / improvements), persisted in
    `speaking_evaluations` (one row per response; resubmit replaces). The **NCLC `level` is derived
    deterministically from `score`** via the shared map (writing-evaluation §Score → NCLC) and is
    **not** stored.
  - **On-request correction** (training only): given the transcript, produce a corrected version of
    the text and improvement suggestions, returned live and **not persisted**.
  - Graceful per-call failure: a Whisper failure → `TRANSCRIPTION_FAILED`; a Claude failure / unparseable
    output → `EVALUATION_FAILED` (submit) or `CORRECTION_FAILED` (correct) — the session is never
    crashed and no partial/invalid row is written.
- Out of scope:
  - Batch/offline scoring (request-time only; no `npm run` equivalent).
  - Phrase-level transcript timing (a single concatenated transcript is enough for scoring; unlike
    listening import, no `transcript_segments` are produced here).
  - Pronunciation/phonetic scoring from the audio waveform (scoring is text-based, on the transcript).
  - Asking the model to assign the NCLC level (it is derived from the score via the shared map).
  - The recorder/results UI (speaking-ui) and the session lifecycle (speaking-session).

## Behaviour

### Configuration & invocation
1. The service reads configuration from `.env`:
   - `CLAUDE_CLI_BIN` (default `claude`), `CLAUDE_CLI_MODEL` (optional `--model`).
   - `WHISPER_CMD` (default `mlx_whisper`), `WHISPER_MODEL` (default `mlx-community/whisper-large-v3-turbo`).
   No API key is read.
2. Claude is invoked non-interactively (`claude -p <prompt>`, plus `--model` when set), capturing
   stdout and parsing the **first JSON object** (tolerating prose/code-fence wrapping), reusing the
   `scripts/lib/claude.ts` helpers (`runClaude`, `extractJsonObject`, `parseCliEnvelope`). Whisper is
   invoked via `scripts/lib/whisper.ts` (`runWhisper`) on the saved file path.

### Transcription (on recording upload)
3. When a recording is uploaded (`POST …/responses/:taskNumber`, see speaking-session), the service
   saves the audio under `MEDIA_DIR` (a path derived from session + task, so re-uploads overwrite),
   runs Whisper on it, and concatenates the returned segments (in order) into one transcript string.
4. The transcript, the saved `audio_path`, and the `duration_ms` are stored on the
   `speaking_responses` row (as a draft — no evaluation yet). The endpoint returns the transcript +
   playback URL.
5. **Platform:** transcription requires Apple Silicon/macOS (Whisper). On a platform where the Whisper
   binary is unavailable or fails, the service returns `TRANSCRIPTION_FAILED` with the captured stderr
   logged; the saved audio is retained so the user can retry (re-upload).

### Scoring (on submit, both modes)
6. When a task is submitted (`POST …/responses/:taskNumber/submit`), the service builds an English
   prompt containing the task `question` and the stored transcript, instructing the model to act as a
   **TCF Canada *Expression orale* examiner** and apply the official assessment criteria (task
   achievement / fluency & coherence / lexical range / grammatical range & accuracy), returning a JSON
   object with:
   - `score`: integer 0–20 for this task.
   - `strengths`: what the response does well.
   - `errors`: notable language errors (grammar, vocabulary, register, coherence) evident in the transcript.
   - `improvements`: concrete suggestions to raise the score.
   The model is **not** asked for the NCLC level.
7. The parsed result (score + feedback) is persisted in `speaking_evaluations`, linked to the response
   (one row per response; resubmitting **replaces** the prior row), with `generated_by` recording
   `claude-cli` (plus `/model` when pinned) and `generated_at` set. The NCLC level is not stored. The
   endpoint returns `score`, the **derived** `level`, and `feedback`.
7a. **Score → NCLC (deterministic):** the `level` is computed from `score` by the same shared pure
    helper and map defined in writing-evaluation §Score → NCLC (e.g. `server/lib/nclc.ts`) — identical
    for writing and speaking, never produced by the model, never persisted. An **overall** NCLC for the
    results/history summary is derived the same way from the rounded mean of the per-task scores.
8. On a Claude failure (non-zero exit) or output with no parseable JSON object, the service logs the
   error (incl. stderr), writes **no** evaluation row, and the endpoint returns `EVALUATION_FAILED`.
   The user can retry by resubmitting.

### Correction (on request, training only)
9. When the user requests a correction (`POST …/correct/:taskNumber`, training only), the service
   builds a prompt with the task `question` and the transcript, instructing the model to return a JSON
   object with:
   - `correctedText`: the transcript rewritten with errors fixed, keeping the user's intent.
   - `suggestions`: a list of specific improvement notes.
10. The result is returned live and is **not persisted** (an iterative aid; re-requestable as the user
    re-records). A real-mode session calling this receives `MODE_NOT_ALLOWED` (enforced in
    speaking-session). Correction failures behave like scoring failures: logged with stderr, no state
    change, endpoint returns `CORRECTION_FAILED`.

## Data model changes
```
-- spec: docs/specs/speaking-evaluation.md §Data model changes
speaking_evaluations
  id            serial primary key
  response_id   integer not null unique references speaking_responses(id)  -- one evaluation per response
  score         integer not null            -- 0..20 for the task (model-produced)
  strengths     text not null
  errors        text not null
  improvements  text not null
  generated_by  text not null               -- 'claude-cli' or 'claude-cli/<model>'
  generated_at  timestamptz not null default now()

  check (score between 0 and 20)
  -- NCLC `level` is NOT stored: it is derived deterministically from `score` on read (writing-evaluation §Score → NCLC).
```
The transcript and `audio_path` live on `speaking_responses` (speaking-session spec). On-request
corrections are **not** stored. Resubmitting replaces the response's `speaking_evaluations` row
(upsert on the unique `response_id`).

## API contract
This service has no routes of its own; it is invoked by the speaking-session endpoints. The shapes it
produces:

```typescript
type SpeakingFeedback = {
  strengths: string      // what the response does well
  errors: string         // notable grammar / vocabulary / register / coherence errors
  improvements: string   // concrete suggestions to raise the score
}

// Returned by POST /api/speaking/sessions/:id/responses/:taskNumber/submit
type SpeakingEvaluation = {
  score: number          // 0–20 (model-produced, persisted)
  level: string          // NCLC, DERIVED from score via the shared map (not stored, not model-produced)
  feedback: SpeakingFeedback
}

// Returned by POST /api/speaking/sessions/:id/correct/:taskNumber (training only; not persisted)
type SpeakingCorrection = {
  correctedText: string  // the transcript rewritten with errors fixed
  suggestions: string[]  // specific improvement notes
}
```
Error codes surfaced by the consuming endpoints: `TRANSCRIPTION_FAILED` (upload), `EVALUATION_FAILED`
(submit), `CORRECTION_FAILED` (correct), `MODE_NOT_ALLOWED` (correct on a real-mode session),
`NO_RECORDING` (submit/correct before a transcript exists).

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The service reads `CLAUDE_CLI_*` and `WHISPER_*` from `.env`, requires no API key, and a missing binary produces a descriptive error. (Behaviour.1)
- [ ] On recording upload the service saves the audio under `MEDIA_DIR`, runs Whisper (`--language fr`), and stores the concatenated transcript + `duration_ms` on the response. (Behaviour.3, 4)
- [ ] A Whisper failure / unavailable binary returns `TRANSCRIPTION_FAILED` (stderr logged) and retains the saved audio for retry; transcription is documented as Apple-Silicon/macOS-only. (Behaviour.5)
- [ ] Submitting a task: the model returns `score` (0–20) + `feedback` (strengths/errors/improvements), persisted in one `speaking_evaluations` row (no `level` column); the response includes a `level` **derived from the score** via the shared §Score → NCLC map. (Behaviour.6, 7, 7a; Data model)
- [ ] The `level` is a pure deterministic function of `score`, computed by the same shared helper as writing, never requested from the model. (Behaviour.7a)
- [ ] Resubmitting the same response replaces its prior evaluation (unique on `response_id`). (Behaviour.7; Data model)
- [ ] A Claude failure or unparseable output on submit writes no row and returns `EVALUATION_FAILED`; the session continues and the user can resubmit. (Behaviour.8)
- [ ] A training-mode correction request returns `correctedText` + `suggestions` live and persists nothing; a real-mode request returns `MODE_NOT_ALLOWED`; a CLI/parse failure returns `CORRECTION_FAILED`. (Behaviour.9, 10)
- [ ] The Claude and Whisper invocations reuse the existing `scripts/lib/claude.ts` and `scripts/lib/whisper.ts` helpers (no duplicated parser); the pure parse/prompt helpers are unit-tested. (Scope)

## Open questions
- **Recording format / transcode.** Browser MediaRecorder typically emits `webm/opus`; confirm
  `mlx_whisper` ingests it directly or whether a small `ffmpeg` transcode (ffmpeg is already a project
  dependency, used by the listening seed) to wav/mp3 is needed before `runWhisper`.
- ~~**NCLC mapping fidelity.**~~ **Resolved 2026-06-17:** the level is **derived deterministically from
  `score`** via the shared §Score → NCLC map (writing-evaluation), not produced by the model. The exact
  band boundaries are provisional — confirm against the official TCF/NCLC correspondence (shared with
  writing).
- **Feedback language.** Feedback is requested in English (consistent with llm-enrichment / writing),
  while the response is French. Confirm.
- **Whisper invocation cost.** Transcription runs synchronously within the upload request; for long
  task-3 recordings this may take several seconds. If it proves too slow, a two-step async job could be
  introduced later (out of scope now).
- **Correction persistence.** Default: ephemeral (not stored), matching writing-evaluation. If review
  should replay corrections, add a table later.

## Revision history
- 2026-06-17: Initial draft (Milestone 11).
- 2026-06-17: Made explicit that transcription reuses the **same** Whisper CLI wrapper as the listening
  import (`scripts/lib/whisper.ts` / `npm run transcribe`), with no alternate path (per user request).
- 2026-06-17: NCLC `level` is now **derived deterministically from `score`** via the shared
  writing-evaluation §Score → NCLC map (`server/lib/nclc.ts`), not produced by the model; dropped the
  stored `level` column. Resolved the NCLC-fidelity open question.
