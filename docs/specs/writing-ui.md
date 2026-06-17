# Spec: Writing Quiz UI

## Status
approved

> Milestone 10. The React UI for the Writing section. Consumes the writing-session endpoints; the
> scoring/feedback and correction shapes come from writing-evaluation. Mirrors the
> reading-quiz-ui / listening-quiz-ui patterns and reuses the shared real-mode timer.

## Goal
Provide the front-end for the Writing section: entry from the section picker, a Training/Real mode
selector, a free-text editor for the three TCF writing tasks with live word counts, a single
60-minute countdown in real mode, training-mode guidance (sample answer + answer template) and an
on-request correction, and a results view showing each task's score (/20), NCLC level, and feedback.

## Scope
- In scope:
  - A Writing entry on the home/section-select screen and a Writing route.
  - Mode selection (Training / Real) and, in training mode, a task selector (single task vs. all
    three).
  - The task editor: one `<textarea>` per presented task with a live word counter against
    `minWords`/`maxWords`, and navigation between tasks.
  - Real mode: a single 60-minute countdown across all three tasks (reusing the quiz-session
    real-mode timer pattern), auto-submit on expiry, manual submit.
  - Training mode: sample-answer and answer-template panels per task, a "Get correction" action, and
    per-task "Submit for score".
  - Draft autosave via the session draft endpoint.
  - Results/review view: per-task score + NCLC + structured feedback cards and an overall summary,
    reachable after completion and read-only via `GET /api/writing/sessions/:id`.
  - French content (`prompt`, `sampleAnswer`, `template`) tagged `lang="fr"` (M9 a11y convention).
- Out of scope:
  - The session lifecycle/endpoints (writing-session) and the Claude evaluation (writing-evaluation).
  - Importing tasks (writing-import).
  - Rich-text editing, spell-check, or autosave conflict resolution beyond last-write-wins.
  - The unified history **list page** itself (owned by the progress-tracking spec) — but the writing
    results/review view defined here is the click target for a writing history row, and is reachable
    read-only via `GET /api/writing/sessions/:id`.

## Behaviour

### Entry & mode selection
1. The section picker shows a **Writing** option alongside Reading and Listening; selecting it routes
   to the Writing start screen.
2. The start screen lets the user choose **Training** or **Real** and shows each mode's rules
   (training: untimed, guidance + correction, submit any task anytime; real: one 60-minute budget for
   all three, no guidance, submit at end / auto-submit on expiry).
3. In **training** mode the user chooses **a single task (1, 2, or 3)** or **all three** before
   starting. In **real** mode all three are always included.
4. Starting calls `POST /api/writing/sessions` and renders the editor with the returned tasks; a
   `NO_TASKS` error shows a clear "no writing tasks imported" message.

### Editor
5. Each presented task shows its `title`/`prompt`/`instructions` (French content `lang="fr"`) and a
   `<textarea>` for the response.
6. A live **word counter** is shown on screen with each task and updates **dynamically as the user
   types** (and as characters are inserted via the on-screen keyboard — see virtual-keyboard spec). It
   displays the **current word count over the task's target** in the form `current / target`
   (e.g. `33 / 60` for a task whose target is 60 words), where the **target is the task's `minWords`**
   (the minimum the response should reach). It visually indicates when the count is **below target**
   and, when `maxWords` is set, when it **exceeds the maximum**. The counter is informational — it does
   not block submission. (If a task has no `minWords`, the counter shows the current count alone.)
6b. The Writing editor includes the **on-screen virtual keyboard** for French accents next to each
    task's textarea (see virtual-keyboard spec, Milestone 12); inserted characters update this word
    counter exactly like typed input.
7. When more than one task is presented, the UI provides navigation between tasks (the user can move
   freely between them and back).
8. The editor autosaves the current draft via `PUT …/responses/:taskNumber` (e.g. on pause/blur/task
   switch); save state is indicated unobtrusively.

### Training mode
9. Each task shows collapsible **Sample answer** and **Template** panels populated from the task
   payload (French content `lang="fr"`); they are hidden when not authored.
10. A **Get correction** action calls `POST …/correct/:taskNumber` with the current draft and renders
    the returned corrected text and suggestions inline; a `CORRECTION_FAILED` error shows a retry
    message without losing the draft.
11. A **Submit for score** action per task calls `POST …/responses/:taskNumber/submit` and renders the
    returned score / NCLC level / feedback for that task; the user may edit and resubmit (the
    displayed result updates). An `EVALUATION_FAILED` error shows a retry message.
12. The user finishes the session explicitly ("Finish"), calling `POST …/complete`.

### Real mode
13. A single **60-minute countdown** is shown for the whole session, initialised from the session's
    `timeLimitMs`. Sample-answer/template panels and the correction action are **not** shown.
14. The user writes across all three tasks within the one budget. Submitting is a single
    end-of-session action ("Submit exam"); there is no per-task scoring shown during the exam.
15. When the countdown reaches zero the session auto-submits (drafts as-is) and routes to results.
    The user may also submit manually before expiry. `elapsedMs` is sent to `POST …/complete`.

### Results / review
16. After completion the results view shows, per task: the response, its **score (/20)**, **NCLC
    level** (derived from the score), and the structured feedback (strengths / errors /
    improvements), plus an **overall summary** (mean score, tasks submitted). A task left unanswered
    shows as not submitted / 0.
17. The results view is reachable read-only later via `GET /api/writing/sessions/:id`; in a
    **training** review the sample answer / template remain visible, in a **real** review they are not
    part of the payload.

## Data model changes
None. This spec is presentation only; all persistence is defined in writing-session and
writing-evaluation.

## API contract
Consumes the writing-session endpoints (`POST /api/writing/sessions`, `PUT …/responses/:taskNumber`,
`POST …/responses/:taskNumber/submit`, `POST …/correct/:taskNumber`, `POST …/complete`,
`GET /api/writing/sessions/:id`) and renders the `WritingTask`, `WritingEvaluation`/`WritingFeedback`,
and `WritingCorrection` shapes defined in those specs. No new endpoints.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The section picker offers Writing and routes to a start screen with Training/Real selection and (training) a single-vs-all-three task choice. (Behaviour.1, 2, 3)
- [ ] Starting renders one `<textarea>` per returned task with prompt text tagged `lang="fr"`, and a `NO_TASKS` start error is shown clearly. (Behaviour.4, 5)
- [ ] Each task shows a live, dynamically-updating word counter in `current / target` form (target = `minWords`, e.g. `33 / 60`) that indicates below-target and over-`maxWords` states without blocking submission, and updates on both typed and on-screen-keyboard input. (Behaviour.6, 6b)
- [ ] Drafts autosave via `PUT …/responses/:taskNumber` with a save-state indicator; multi-task sessions allow navigation between tasks. (Behaviour.7, 8)
- [ ] Training: sample-answer and template panels render from the payload (hidden when absent); "Get correction" renders corrected text + suggestions; "Submit for score" renders score/level/feedback and supports resubmission. (Behaviour.9, 10, 11)
- [ ] Real: a single 60-minute countdown is shown; no guidance/correction is available; auto-submit on expiry and manual "Submit exam" both route to results with `elapsedMs` sent. (Behaviour.13, 14, 15)
- [ ] Results show per-task score/20 + NCLC (derived from the score) + feedback and an overall summary; the view is reachable read-only via `GET /api/writing/sessions/:id`. (Behaviour.16, 17)
- [ ] Evaluation/correction failures (`EVALUATION_FAILED` / `CORRECTION_FAILED`) show a retry affordance without losing the draft. (Behaviour.10, 11)

## Open questions
- **Autosave trigger.** On blur / task switch / debounced interval — pick one (debounced interval +
  on task switch recommended) so frequent small `PUT`s stay cheap.
- **Real-mode per-task scores during the exam.** Hidden until the end (recommended, exam-authentic).
  Confirm we do not want any in-exam feedback in real mode.
- **Timer reuse.** The real-mode countdown should reuse the existing quiz-session timer component/
  hook rather than a new one; confirm the existing timer is general enough for a session-level (not
  per-question) budget.

## Revision history
- 2026-06-17: Initial draft (Milestone 10).
- 2026-06-17: Status moved draft → approved.
- 2026-06-17: Refined the word counter (Behaviour.6) to a dynamic on-screen `current / target` display
  (target = `minWords`, e.g. `33 / 60`), and added the on-screen French-accent keyboard integration
  point (Behaviour.6b → virtual-keyboard spec, Milestone 12). Pre-implementation refinements directed
  by the user; remains approved.
