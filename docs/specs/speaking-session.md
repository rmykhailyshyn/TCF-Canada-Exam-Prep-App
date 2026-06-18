# Spec: Speaking Session

## Status
approved

> Milestone 11. Session lifecycle for the Speaking section. The Whisper transcription and Claude
> scoring/feedback produced on submit, plus the on-request correction, are defined in the
> speaking-evaluation spec; the recorder and results UI in the speaking-ui spec. Reuses the existing
> `sessions` table from quiz-session, mirroring writing-session.

## Goal
Define the session model for the Speaking section (TCF *Expression orale*) — the fourth exam section.
A speaking session represents one attempt at the three speaking tasks in either **training mode**
(no time limit, sample answer shown, on-request correction) or **real mode** (per-task time limits
with a prep phase before tasks 2 & 3, matching the real exam). Responses are **voice recordings**:
the user records audio, which is saved and transcribed (Whisper) into text on which scoring and
correction operate. Submission, transcription, and scoring are covered in speaking-evaluation.

## Scope
- In scope:
  - Session creation for the Speaking section: mode selection and the task set presented.
  - Training mode: a user-chosen **single task or all three**, no timers, sample answer exposed.
  - Real mode: **all three tasks**, **per-task** prep + recording time limits from config, recording
    auto-stop at the limit, submit at the end (or auto-submit on session end).
  - Per-task recording capture (audio saved to disk + transcribed into the response) and per-task
    submission/evaluation.
  - Session completion and the aggregate result shape.
  - Real-mode per-task task selection (one random task per task number when a pool exists).
  - Speaking timing configuration (external config, not hardcoded).
  - Retaining the completed attempt (recordings + transcripts + per-task scores + feedback) and
    listing it in the unified session history for later review and analysis (see progress-tracking spec).
- Out of scope:
  - The Whisper transcription, Claude scoring + feedback, and on-request correction behaviour
    (speaking-evaluation spec).
  - The recorder UI, timer display, and results rendering (speaking-ui spec).
  - Importing the tasks (speaking-import spec).
  - Pausing a real-mode session.

## Behaviour

### Mode selection
1. Before starting, the user selects the Speaking section and a mode: **Training** or **Real**.
2. The app displays the mode rules before the session begins:
   - Training: no time limit; sample answer available; on-request correction of the transcript;
     submit any task for a score at any time.
   - Real: per-task time limits (a prep countdown before tasks 2 & 3, then a recording limit per
     task); no sample answer/correction; recordings are scored at the end.
3. In **training mode** the user additionally chooses **a single task (1, 2, or 3)** or **all three**.
   In **real mode** all three tasks are always included, presented in ascending task-number order.

### Mode storage note (reuse)
The speaking session reuses the shared `sessions` table. The user-facing "Training" mode is stored as
`mode = 'learning'` (the existing enum value) — identical to the writing-session decision — so session
history/completion/review queries stay uniform across all sections; the Speaking UI labels
`'learning'` as "Training". `difficulty` is always null for speaking.

### Task selection
4. A `task_number` (1–3) may have **more than one** imported `speaking_tasks` row (a candidate pool;
   see speaking-import). Selection resolves the pool per session at creation time:
   - **Real mode** and **training, all three** select one random task per task number 1–3, presented
     in ascending order. This mirrors the per-position draw in quiz-session §19–22.
   - **Training, single task** selects one random task from the chosen task number's pool.
5. Selection is fixed for a session's lifetime (the same tasks are used by its results/review view);
   re-entering re-draws.
6. Starting a session fails with `NO_TASKS` when a required task number has no imported task.

### Training mode
7. The session presents the selected task(s) with no timers.
8. For each presented task the payload includes its `sample_answer` (when authored) so the UI can
   show guidance.
9. For each task the user records audio (see Recording). On upload the audio is transcribed
   (speaking-evaluation); the resulting transcript is the editable "draft" the user submits/corrects.
10. The user may submit any task at any time to receive a score + feedback (speaking-evaluation), and
    may request a correction for the current transcript (speaking-evaluation). Submitting does not end
    the session; the user may re-record and resubmit (the latest evaluation replaces the previous one
    for that response).
11. The session ends when the user explicitly finishes (or quits).

### Real mode
12. Tasks are presented one at a time in ascending order. Each task runs a **prep phase**
    (`prepSeconds`, 0 for task 1) during which the prompt is shown but recording is disabled, then a
    **recording phase** (`recordSeconds`) during which the user records; recording **auto-stops** when
    `recordSeconds` elapses. `sample_answer` is **omitted** from the payload; correction is
    unavailable.
13. After a task's recording phase ends (auto-stop or manual stop), the audio is uploaded and
    transcribed, and the session advances to the next task. The user cannot return to a completed task.
14. When all three tasks are done (or the user submits), the session completes: every recorded task is
    submitted/evaluated and the session is finalised. Total elapsed time is recorded on the session row.

### Recording
15. A task's response is a single audio recording. Re-recording (training, or before a real-mode task
    advances) replaces the prior audio + transcript for that `(session, task_number)`. The audio file
    is saved under `MEDIA_DIR` and referenced by the response row; the transcript is stored alongside.

### Completion & results
16. On completion each recorded response has (or receives) an evaluation. The completion result reports
    per task: the transcript, its `score` (/20), `level` (NCLC estimate), and feedback; plus an
    **overall** summary (mean of the per-task scores, and the count of tasks recorded/submitted). A
    task with no recording contributes a score of 0 to the overall mean in real mode.
17. After completion the user can re-open the session read-only (results/review), with **audio
    playback** of each recording, via `GET /api/speaking/sessions/:id`.
17a. The completed session appears in the **unified session history** (progress-tracking spec) as a
    "Speaking" row with its overall /20 average and tasks-submitted count, intermixed newest-first with
    the other sections. Its per-task recordings (`audio_path` under `MEDIA_DIR`), transcripts, scores,
    NCLC levels, and feedback are persisted (`speaking_responses` + `speaking_evaluations`) and are not
    deleted by normal use, so any past attempt remains available for later review and analysis.

### Configuration
18. Speaking timing is read from `exam.config.json` (repo root) and never hardcoded. A `speaking`
    block defines, per task number, `prepSeconds` and `recordSeconds`. Representative defaults
    (tunable in config):

    | Task | prepSeconds | recordSeconds |
    |---|---|---|
    | 1 (entretien dirigé)       | 0   | 120 |
    | 2 (exercice en interaction)| 120 | 210 |
    | 3 (point de vue)           | 120 | 270 |

## Data model changes
Reuses the existing `sessions` table with one constraint change, and adds one new table.

```
-- sessions (existing): extend the section check to allow speaking.
--   section check: section in ('reading', 'listening', 'writing', 'speaking')
--   mode: 'learning' (presented as "Training" for speaking) | 'real'
--   difficulty: always null for speaking
--   elapsed_ms: real mode only (total session elapsed); null in training
-- spec: docs/specs/speaking-session.md §Data model changes

-- spec: docs/specs/speaking-session.md §Data model changes
speaking_responses
  id               serial primary key
  session_id       integer not null references sessions(id)
  speaking_task_id integer not null references speaking_tasks(id)
  task_number      integer not null            -- 1..3, denormalised for ordering/display
  audio_path       text                        -- file under MEDIA_DIR; null until first recording
  transcript       text                        -- Whisper output; null until transcribed
  duration_ms      integer                     -- recording length; null until known
  submitted_at     timestamptz                 -- null while a draft; set on submit / session end

  unique (session_id, task_number)             -- one response row per task per session
  check (task_number between 1 and 3)
```
The per-response score + feedback live in `speaking_evaluations` (speaking-evaluation spec), keyed by
`response_id`.

## API contract
All endpoints use the standard `{ "data": …, "error": null }` / `{ "data": null, "error": {…} }`
envelope. Transcription/scoring fields are produced by the speaking-evaluation layer.

### POST /api/speaking/sessions
Start a speaking session.
```
Request:  { "mode": "learning" | "real", "taskNumbers"?: number[] }
Response: { "data": { "sessionId": number, "mode": "learning" | "real",
                      "tasks": SpeakingTask[], "timing": TaskTiming[] | null }, "error": null }
Error (no tasks): { "data": null, "error": { "code": "NO_TASKS", "message": "..." } }
Error (bad mode): { "data": null, "error": { "code": "INVALID_MODE", "message": "..." } }
```
- `taskNumbers` is meaningful only in training mode: omit (or `[1,2,3]`) for all three, or `[n]` for a
  single task. Ignored in real mode (always all three).
- `tasks` is the resolved set (Behaviour.4), ordered by `task_number`. Each `SpeakingTask` carries
  `taskId`, `taskNumber`, `question`. In **training** mode it also carries `sampleAnswer`; in **real**
  mode that field is omitted.
- `timing` is `null` in training mode and, in real mode, an array of
  `{ taskNumber, prepSeconds, recordSeconds }` from `exam.config.json` (Behaviour.18).

### POST /api/speaking/sessions/:id/responses/:taskNumber
Upload a recording for a task. `multipart/form-data` with an audio file part. Saves the audio under
`MEDIA_DIR`, **transcribes** it (speaking-evaluation), and stores the transcript as a draft (no
scoring). Re-uploading replaces the prior audio + transcript.
```
Response: { "data": { "transcript": string, "audioUrl": string, "durationMs": number | null },
            "error": null }
Error (transcription): { "data": null, "error": { "code": "TRANSCRIPTION_FAILED", "message": "..." } }
```
`audioUrl` points at the playback route below.

### POST /api/speaking/sessions/:id/responses/:taskNumber/submit
Submit a task's transcribed response and evaluate it (speaking-evaluation). Allowed in both modes.
```
Response: { "data": { "score": number, "level": string,
                      "feedback": SpeakingFeedback }, "error": null }
Error (no transcript): { "data": null, "error": { "code": "NO_RECORDING", "message": "..." } }
Error (eval failure):  { "data": null, "error": { "code": "EVALUATION_FAILED", "message": "..." } }
```
Sets `submitted_at`, persists a `speaking_evaluations` row, and returns the score/level/feedback.
Resubmitting replaces the prior evaluation. `SpeakingFeedback` is defined in speaking-evaluation.

### POST /api/speaking/sessions/:id/correct/:taskNumber
Training mode only — request a correction/suggestions for the current transcript
(speaking-evaluation). Returns `MODE_NOT_ALLOWED` for a real-mode session, `NO_RECORDING` if the task
has no transcript yet.

### GET /api/speaking/sessions/:id/responses/:taskNumber/audio
Range-aware streaming of the saved recording for playback (reuses the `parseRange` helper from the
listening audio route). Returns `NOT_FOUND` when the file is missing on disk.

### POST /api/speaking/sessions/:id/complete
Finalise the session (real-mode end, or training "finish").
```
Request:  { "elapsedMs": number | null }
Response: { "data": { "tasks": Array<{ taskNumber: number, score: number | null,
                      level: string | null }>, "overallScore": number, "submitted": number },
            "error": null }
```
In real mode the server submits/evaluates any recorded-but-unsubmitted task before computing the
aggregate. `elapsedMs` is null in training mode. `overallScore` is the mean of the per-task scores
(un-recorded tasks counting as 0 in real mode); `submitted` is the number of tasks evaluated.

### GET /api/speaking/sessions/:id
Read-only results/review: the session, its resolved tasks (with prompts; sample answer only for
training sessions), each response's transcript + `audioUrl`, and its stored evaluation
(score/level/feedback) — or `null` where a task was never recorded.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] `POST /api/speaking/sessions` starts a session for `mode` `learning`/`real`; training honours `taskNumbers` (single or all three), real mode always returns all three in ascending order. (Behaviour.1, 3, 4; API contract)
- [ ] Returned `tasks` include `sampleAnswer` in training mode and omit it in real mode; `timing` is null in training and the `exam.config.json` per-task values in real mode (never hardcoded). (Behaviour.8, 12, 18; API contract)
- [ ] When a required task number has no imported task, `POST /api/speaking/sessions` returns `NO_TASKS`. (Behaviour.6)
- [ ] When a task number has multiple candidates, exactly one is drawn at random per session and the resolved set is stable for that session's lifetime. (Behaviour.4, 5)
- [ ] `POST …/responses/:taskNumber` saves the audio under `MEDIA_DIR`, transcribes it, stores `audio_path`/`transcript`/`duration_ms` as a draft (no `submitted_at`), and re-uploading replaces them. (Behaviour.9, 15; Data model)
- [ ] `POST …/responses/:taskNumber/submit` evaluates the transcript, sets `submitted_at`, returns `score`/`level`/`feedback`, and resubmitting replaces the prior evaluation; submitting with no transcript returns `NO_RECORDING`. (Behaviour.10, 16; API contract)
- [ ] `GET …/responses/:taskNumber/audio` streams the recording with range support for seekable playback; a missing file returns `NOT_FOUND`. (Behaviour.17; API contract)
- [ ] Real mode: per-task prep + recording limits are surfaced; reaching `complete` submits/evaluates any recorded task (un-recorded count as 0), records `elapsed_ms`, and returns per-task scores plus `overallScore` (mean) and `submitted`. (Behaviour.12, 14, 16; API contract)
- [ ] `GET /api/speaking/sessions/:id` returns the session, transcripts + `audioUrl`s, and stored evaluations read-only, with sample answer present only for training sessions. (Behaviour.17; API contract)
- [ ] Each `speaking_responses` row is unique per `(session_id, task_number)` and links to its session and `speaking_tasks` row; a speaking session is stored with `section = 'speaking'`, null `difficulty`, and (real mode) `elapsed_ms`. (Mode storage note; Data model)
- [ ] A completed speaking session appears in the unified history list (`GET /api/sessions`) with its overall /20 average + tasks-submitted, and its per-task recordings/transcripts/scores/feedback remain persisted and retrievable afterward for analysis. (Behaviour.17a; progress-tracking spec)

## Open questions
- **Prep-phase enforcement.** Default: in real mode the recording control is disabled until
  `prepSeconds` elapses (the user may skip prep to start early). Confirm vs. purely informational prep.
- **Auto-advance vs. manual next in real mode.** Default: after a task's recording phase ends the
  session advances automatically once the upload/transcription completes. Confirm whether a manual
  "Next task" step is wanted.
- **Overall score for partial real sessions.** Default: un-recorded tasks count as 0 in the mean
  (consistent with writing-session). Confirm.
- ~~**History integration.**~~ **Resolved 2026-06-17:** speaking sessions are **in scope** for the
  unified history — retained with per-task recordings/transcripts/scores/feedback and listed alongside
  the other sections (Behaviour.17a). The progress-tracking spec was revised accordingly (§Writing &
  speaking sessions, Behaviour.9–12), per SDD Rule 4.

## Revision history
- 2026-06-17: Initial draft (Milestone 11).
- 2026-06-17: History made in scope (Behaviour.17a + acceptance) — completed speaking attempts are
  retained with recordings/transcripts/scores/feedback and listed in the unified history; resolved the
  history open question and triggered the progress-tracking revision (Rule 4). (Tasks are already drawn
  at random from the imported task bank per §Task selection.)
- 2026-06-18: Approved (Milestone 11).
