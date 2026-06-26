# Spec: Writing Session

## Status

implemented

> Milestone 10. Session lifecycle for the Writing section. The scoring/feedback produced on submit
> and the on-request correction are defined in the writing-evaluation spec; the editor and results
> UI in the writing-ui spec. Reuses the existing `sessions` table from quiz-session.

## Goal

Define the session model for the Writing section — the third exam section after reading and
listening. A writing session represents one attempt at the Writing tasks in either **training mode**
(no time limit, guidance shown, on-request correction) or **real mode** (a single **60-minute**
limit across all three tasks, no guidance). Unlike reading/listening, responses are **free text**
(not multiple choice), so this spec introduces a writing-specific response model and reuses the
shared `sessions` row for lifecycle/timing. Submission and scoring are covered in writing-evaluation.

## Scope

- In scope:
  - Session creation for the Writing section: mode selection and the task set presented.
  - Training mode: a user-chosen **single task or all three**, no timer, sample answer + template
    exposed in the payload.
  - Real mode: **all three tasks**, a single 60-minute countdown across the whole session,
    auto-submit on expiry or manual submit.
  - Per-task response capture (autosave drafts) and per-task submission.
  - Session completion and the aggregate result shape.
  - Real-mode task selection (one random task per task number when a pool exists).
  - Exam timing configuration for writing (external config, not hardcoded).
  - Retaining the completed attempt (responses + per-task scores + feedback) and listing it in the
    unified session history for later review and analysis (see progress-tracking spec).
- Out of scope:
  - The Claude scoring + feedback and the on-request correction behaviour (writing-evaluation spec).
  - The editor UI, timer display, word counter, and results rendering (writing-ui spec).
  - Importing the tasks (writing-import spec).
  - Pausing a real-mode session (consistent with quiz-session).

## Behaviour

### Mode selection

1. Before starting, the user selects the Writing section and a mode: **Training** or **Real**.
2. The app displays the mode rules before the session begins:
   - Training: no time limit; sample answer + template available; on-request correction; submit any
     task for a score at any time.
   - Real: a single 60-minute limit for all three tasks together; no sample answer/template/
     correction; submit at the end (or auto-submit when the timer expires).
3. In **training mode** the user additionally chooses to practise **a single task** (task 1, 2, or 3)
   or **all three**. In **real mode** all three tasks are always included.

### Mode storage note (reuse)

The writing session reuses the shared `sessions` table. The user-facing "Training" mode is stored as
`mode = 'learning'` (the existing enum value) so session history, completion, and review queries
remain uniform across all three sections; the Writing UI simply labels `'learning'` as "Training".
`difficulty` is always null for writing (no difficulty bands). See Open questions.

### Task selection

4. A `task_number` (1–3) may have **more than one** imported `writing_tasks` row (a candidate pool;
   see writing-import). Selection resolves the pool into the presented set:
   - **Real mode** selects, independently for each task number 1–3, exactly **one** task at random
     from that number's candidate pool, and presents the three in ascending task-number order. This
     mirrors the per-position draw in quiz-session §Question selection and ordering (Behaviour.19–20).
   - **Training, all three** selects one random task per task number 1–3 (same as real, but untimed).
   - **Training, single task** selects one random task from the chosen task number's pool.
5. Selection is resolved **per session** at creation time; re-entering re-draws. A session's resolved
   set is fixed for that session's lifetime (the same tasks are used by its results/review view).
6. Starting a session fails with `NO_TASKS` when a required task number has no imported task (in real
   mode or training-all-three: any of 1–3 empty; in training-single: the chosen number empty).

### Training mode

7. The session presents the selected task(s) with no time constraint and no countdown.
8. For each presented task the payload includes its `sample_answer` and `template` (when authored) so
   the UI can show guidance.
9. The user types a response per task; drafts are autosaved (see Behaviour.13).
10. The user may submit any task at any time to receive a score + feedback (writing-evaluation), and
    may request a correction for the current draft of a task (writing-evaluation). Submitting a task
    does not end the session; the user may keep editing and resubmit (the latest evaluation replaces
    the previous one for that response).
11. The session ends when the user explicitly finishes (or quits).

### Real mode

12. A single 60-minute countdown is displayed for the whole session, initialised from the configured
    writing time limit. `sample_answer`/`template` are **omitted** from the payload; correction is
    unavailable.
13. The user types responses for all three tasks within the one time budget, switching freely between
    them. Drafts are autosaved as the user types/switches.
14. When the timer reaches zero the session auto-submits: every task's current draft is submitted
    as-is (including empty drafts) and the session completes. The user may also submit manually before
    expiry. Elapsed time is recorded on the session row.

### Completion & results

15. On completion each submitted response has (or receives) an evaluation (writing-evaluation). The
    completion result reports, per task: the response, its `score` (/20), `level` (NCLC estimate), and
    feedback; plus an **overall** summary (the mean of the per-task scores, and the count of tasks
    submitted). An empty/unsubmitted task contributes a score of 0 to the overall mean in real mode.
16. After completion the user can re-open the session read-only (results/review) via
    `GET /api/writing/sessions/:id`.
    16a. The completed session appears in the **unified session history** (progress-tracking spec) as a
    "Writing" row with its overall /20 average and tasks-submitted count, intermixed newest-first with
    reading/listening/speaking attempts. Its per-task responses, scores, NCLC levels, and feedback are
    persisted (`writing_responses` + `writing_evaluations`) and are not deleted by normal use, so any
    past attempt remains available for later review and analysis.

### Configuration

17. The writing time limit is read from `exam.config.json` (repo root) and never hardcoded. Default:
    - Writing: **60 minutes**, **3 tasks**.

## Data model changes

Reuses the existing `sessions` table with one constraint change, and adds one new table.

```
-- sessions (existing): extend the section check to allow writing.
--   section check: section in ('reading', 'listening', 'writing')
--   mode: 'learning' (presented as "Training" for writing) | 'real'
--   difficulty: always null for writing
--   elapsed_ms: real mode only (the single 60-min budget); null in training
-- spec: docs/specs/writing-session.md §Data model changes

-- spec: docs/specs/writing-session.md §Data model changes
writing_responses
  id              serial primary key
  session_id      integer not null references sessions(id)
  writing_task_id integer not null references writing_tasks(id)
  task_number     integer not null            -- 1..3, denormalised for ordering/display
  response_text   text not null default ''    -- the user's current/submitted draft
  word_count      integer                     -- computed on save; null until first save
  submitted_at    timestamptz                 -- null while a draft; set on submit / auto-submit

  unique (session_id, task_number)            -- one response row per task per session
  check (task_number between 1 and 3)
```

The per-response score + feedback live in `writing_evaluations` (writing-evaluation spec), keyed by
`response_id`.

## API contract

All endpoints use the standard `{ "data": …, "error": null }` / `{ "data": null, "error": {…} }`
envelope. Scoring fields returned on submit/complete are produced by the writing-evaluation layer.

### POST /api/writing/sessions

Start a writing session.

```
Request:  { "mode": "learning" | "real", "taskNumbers"?: number[] }
Response: { "data": { "sessionId": number, "mode": "learning" | "real",
                      "tasks": WritingTask[], "timeLimitMs": number | null }, "error": null }
Error (no tasks): { "data": null, "error": { "code": "NO_TASKS", "message": "..." } }
Error (bad mode): { "data": null, "error": { "code": "INVALID_MODE", "message": "..." } }
```

- `taskNumbers` is meaningful only in training mode: omit (or `[1,2,3]`) for all three, or a single
  `[n]` to practise one task. In real mode it is ignored (always all three).
- `tasks` is the resolved set (Behaviour.4), ordered by `task_number`. Each `WritingTask` carries
  `taskId`, `taskNumber`, `title`, `prompt`, `instructions`, `minWords`, `maxWords`. In **training**
  mode it also carries `sampleAnswer` and `template`; in **real** mode those two fields are omitted.
- `timeLimitMs` is `null` in training mode and the configured 60-min value in real mode.

### PUT /api/writing/sessions/:id/responses/:taskNumber

Autosave a draft response (no scoring).

```
Request:  { "text": string }
Response: { "data": { "wordCount": number }, "error": null }
```

Upserts the `writing_responses` row for `(session_id, task_number)`, updates `response_text` and the
computed `word_count`, and leaves `submitted_at` null.

### POST /api/writing/sessions/:id/responses/:taskNumber/submit

Submit one task's response and evaluate it (see writing-evaluation). Allowed in both modes.

```
Request:  { "text": string }
Response: { "data": { "score": number, "level": string,
                      "feedback": WritingFeedback }, "error": null }
Error (eval failure): { "data": null, "error": { "code": "EVALUATION_FAILED", "message": "..." } }
```

Saves the response (sets `submitted_at`), invokes the Claude evaluation, persists a
`writing_evaluations` row, and returns the score/level/feedback. Resubmitting replaces the prior
evaluation for that response. `WritingFeedback` is defined in the writing-evaluation spec.

### POST /api/writing/sessions/:id/correct/:taskNumber

Training mode only — request a correction/suggestions for the current draft (see writing-evaluation).
Returns `MODE_NOT_ALLOWED` if the session is real mode.

### POST /api/writing/sessions/:id/complete

Finalise the session (manual submit, timer expiry, or training "finish").

```
Request:  { "elapsedMs": number | null }
Response: { "data": { "tasks": Array<{ taskNumber: number, score: number | null,
                      level: string | null }>, "overallScore": number, "submitted": number },
            "error": null }
```

In real mode the server submits/evaluates any task still in draft (Behaviour.14) before computing the
aggregate. `elapsedMs` is null in training mode. `overallScore` is the mean of the per-task scores
(unsubmitted tasks counting as 0 in real mode); `submitted` is the number of tasks actually answered.

### GET /api/writing/sessions/:id

Read-only results/review: the session, its resolved tasks (with prompts; sample answer/template
included only for training sessions), each response's text, and its stored evaluation
(score/level/feedback) — or `null` where a task was never submitted.

## Acceptance criteria

Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] `POST /api/writing/sessions` starts a session for `mode` `learning`/`real`; training mode honours `taskNumbers` (single or all three), real mode always returns all three. (Behaviour.1, 3, 4; API contract)
- [ ] The returned `tasks` include `sampleAnswer`/`template` in training mode and **omit** them in real mode. (Behaviour.8, 12; API contract)
- [ ] `timeLimitMs` is null in training mode and the `exam.config.json` writing value (60 min) in real mode; the value is never hardcoded. (Behaviour.12, 17; API contract)
- [ ] When a required task number has no imported task, `POST /api/writing/sessions` returns `NO_TASKS`. (Behaviour.6)
- [ ] When a task number has multiple imported candidates, exactly one is drawn at random per session and the resolved set is stable for that session's lifetime. (Behaviour.4, 5)
- [ ] `PUT …/responses/:taskNumber` upserts the draft, stores `response_text` + computed `word_count`, and leaves `submitted_at` null. (Behaviour.9, 13; Data model)
- [ ] `POST …/responses/:taskNumber/submit` saves the response (sets `submitted_at`), returns `score`/`level`/`feedback`, and resubmitting replaces the prior evaluation. (Behaviour.10, 15; API contract)
- [ ] Real mode: manual submit or timer expiry triggers `complete`, which submits/evaluates any draft task (including empty ones), records `elapsed_ms`, and returns per-task scores plus `overallScore` (mean) and `submitted`. (Behaviour.14, 15; API contract)
- [ ] `GET /api/writing/sessions/:id` returns the session, responses, and stored evaluations read-only, with sample answer/template present only for training sessions. (Behaviour.16; API contract)
- [ ] Each `writing_responses` row is unique per `(session_id, task_number)` and links to its session and `writing_tasks` row. (Data model)
- [ ] A writing session is stored with `section = 'writing'`, `mode` `learning`/`real`, null `difficulty`, and (real mode only) `elapsed_ms`. (Mode storage note; Data model)
- [ ] A completed writing session appears in the unified history list (`GET /api/sessions`) with its overall /20 average + tasks-submitted, and its per-task responses/scores/feedback remain persisted and retrievable afterward for analysis. (Behaviour.16a; progress-tracking spec)

## Open questions

- ~~**Mode storage value.** "Training" is stored as `mode = 'learning'` vs. adding a `'training'`
  enum value.~~ **Resolved 2026-06-17:** the writing "Training" mode **is** the existing `learning`
  mode — stored as `mode = 'learning'` and only labelled "Training" in the Writing UI. No new enum
  value and no `sessions` check-constraint change; section/history/review queries stay uniform.
- **Overall score for partial real sessions.** Default: unsubmitted tasks count as 0 in the mean.
  Alternative: average only submitted tasks and show a "1 of 3 submitted" note. Confirm.
- **Autosave cadence.** The `PUT` draft endpoint exists; whether the client autosaves on an interval,
  on blur, or on task switch is a writing-ui concern, but the endpoint contract must support frequent
  small saves.
- ~~**History integration.**~~ **Resolved 2026-06-17:** writing sessions are **in scope** for the
  unified history — they are retained with per-task scores + feedback and listed alongside the other
  sections (Behaviour.16a). The progress-tracking spec was revised accordingly (§Writing & speaking
  sessions, Behaviour.9–12), per SDD Rule 4, rather than silently changed.

## Revision history

- 2026-06-17: Initial draft (Milestone 10).
- 2026-06-17: Resolved the mode-storage open question — the writing "Training" mode is the existing
  `learning` mode (`mode = 'learning'`, labelled "Training" in the UI); no new enum value.
- 2026-06-17: History made in scope (Behaviour.16a + acceptance) — completed writing attempts are
  retained with per-task scores + feedback and listed in the unified history; resolved the history
  open question and triggered the progress-tracking revision (Rule 4). (Tasks are already drawn at
  random from the imported task bank per §Task selection.)
- 2026-06-17: Status moved draft → approved.
