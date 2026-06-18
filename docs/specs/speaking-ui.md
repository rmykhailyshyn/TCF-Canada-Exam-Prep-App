# Spec: Speaking Quiz UI

## Status
approved

> Milestone 11. The React UI for the Speaking section. Consumes the speaking-session endpoints; the
> transcript/score/feedback and correction shapes come from speaking-evaluation. Reuses the listening
> audio-playback pattern and the real-mode timer pattern; introduces in-browser audio recording.

## Goal
Provide the front-end for the Speaking section: entry from the section picker, a Training/Real mode
selector, an **in-browser audio recorder** for each of the three TCF speaking tasks, per-task prep +
recording countdowns in real mode, training-mode guidance (sample answer + transcript + on-request
correction), and a results view showing each task's recording playback, transcript, score (/20),
NCLC level, and feedback.

## Scope
- In scope:
  - A Speaking entry on the section picker and a Speaking route.
  - Mode selection (Training / Real) and, in training mode, a task selector (single task vs. all three).
  - The **recorder**: microphone permission, record / stop, playback of the captured take, and
    re-record — built with the browser MediaRecorder/`getUserMedia` API (none exists in the app today).
  - Upload of a recording to the session endpoint, showing the returned **transcript**.
  - Real mode: per-task **prep countdown → recording countdown** driven by the session `timing`
    payload; recording auto-stops at the limit; advance through the three tasks.
  - Training mode: sample-answer panel, the transcript, a **"Get correction"** action, and per-task
    **"Submit for score"**.
  - Results/review: per-task audio playback + transcript + score/NCLC/feedback cards + overall summary,
    reachable after completion and read-only via `GET /api/speaking/sessions/:id`.
  - French content (`question`, `sampleAnswer`) tagged `lang="fr"` (M9 a11y convention).
- Out of scope:
  - The session lifecycle/endpoints (speaking-session), Whisper transcription, and Claude evaluation
    (speaking-evaluation).
  - Importing tasks (speaking-import).
  - Waveform visualisation or client-side audio editing/trimming.
  - The unified history **list page** itself (owned by the progress-tracking spec) — but the speaking
    results/review view defined here is the click target for a speaking history row, and is reachable
    read-only via `GET /api/speaking/sessions/:id`.

## Behaviour

### Entry & mode selection
1. The section picker shows a **Speaking** option alongside Reading, Listening, and Writing; selecting
   it routes to the Speaking start screen.
2. The start screen lets the user choose **Training** or **Real** and shows each mode's rules (training:
   untimed, sample answer + correction, submit any task anytime; real: per-task prep + recording time
   limits, no guidance, scored at the end).
3. In **training** mode the user chooses **a single task (1, 2, or 3)** or **all three**. In **real**
   mode all three are always included.
4. Starting calls `POST /api/speaking/sessions` and renders the recorder for the returned tasks; a
   `NO_TASKS` error shows a clear "no speaking tasks imported" message.

### Recorder
5. Each presented task shows its `question` (French content `lang="fr"`) and a recorder control.
6. On first record the UI requests **microphone permission** via `getUserMedia`; if denied, it shows a
   clear message and a retry affordance. Recording uses MediaRecorder; **Record** starts, **Stop**
   ends, and the captured take can be **played back** locally before upload.
7. Stopping a recording uploads it via `POST …/responses/:taskNumber` and renders the returned
   transcript; a `TRANSCRIPTION_FAILED` error shows a retry message and keeps the local take so the
   user can re-upload. Re-recording replaces the take and (on re-upload) the transcript.

### Training mode
8. Each task shows a collapsible **Sample answer** panel from the task payload (`lang="fr"`; hidden when
   absent) and, after upload, the **transcript** of the user's recording.
9. A **Get correction** action calls `POST …/correct/:taskNumber` and renders the corrected text +
   suggestions inline; a `CORRECTION_FAILED` error shows a retry message.
10. A **Submit for score** action per task calls `POST …/responses/:taskNumber/submit` and renders the
    returned score / NCLC level / feedback; the user may re-record and resubmit (the displayed result
    updates). An `EVALUATION_FAILED` error shows a retry message.
11. The user finishes the session explicitly ("Finish"), calling `POST …/complete`.

### Real mode
12. Tasks are presented one at a time in ascending order. Each task first runs a **prep countdown**
    (`prepSeconds`; skipped/zero for task 1) during which the prompt is shown and recording is disabled,
    then a **recording countdown** (`recordSeconds`) during which the user records. Recording
    **auto-stops** when the recording countdown reaches zero (the user may stop earlier). The sample
    answer and correction are **not** shown.
13. When a task's recording is stopped, the UI uploads it (showing a brief "transcribing…" state) and
    advances to the next task. There is no per-task score shown during the exam, and the user cannot
    return to a completed task.
14. After the third task (or an explicit "Submit exam"), the UI calls `POST …/complete` with
    `elapsedMs` and routes to results.

### Results / review
15. The results view shows, per task: an **audio player** for the recording (streamed from
    `GET …/responses/:taskNumber/audio`), the **transcript**, the **score (/20)**, the **NCLC level**
    (derived from the score), and the structured feedback (strengths / errors / improvements), plus an
    **overall summary** (mean score, tasks submitted). A task with no recording shows as not submitted / 0.
16. The results view is reachable read-only later via `GET /api/speaking/sessions/:id`; in a **training**
    review the sample answer remains visible, in a **real** review it is not part of the payload.

## Data model changes
None. Presentation only; persistence is defined in speaking-session and speaking-evaluation.

## API contract
Consumes the speaking-session endpoints (`POST /api/speaking/sessions`, `POST …/responses/:taskNumber`,
`POST …/responses/:taskNumber/submit`, `POST …/correct/:taskNumber`,
`GET …/responses/:taskNumber/audio`, `POST …/complete`, `GET /api/speaking/sessions/:id`) and renders
the `SpeakingTask`, `SpeakingEvaluation`/`SpeakingFeedback`, and `SpeakingCorrection` shapes defined in
those specs. No new endpoints.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The section picker offers Speaking and routes to a start screen with Training/Real selection and (training) a single-vs-all-three task choice. (Behaviour.1, 2, 3)
- [ ] Starting renders a recorder per returned task with the prompt tagged `lang="fr"`, and a `NO_TASKS` start error is shown clearly. (Behaviour.4, 5)
- [ ] The recorder requests microphone permission, records/stops via MediaRecorder, allows local playback before upload, and handles permission denial gracefully. (Behaviour.6)
- [ ] Stopping a recording uploads it and shows the returned transcript; `TRANSCRIPTION_FAILED` shows a retry without losing the local take; re-recording replaces the take/transcript. (Behaviour.7)
- [ ] Training: the sample-answer panel renders from the payload (hidden when absent); "Get correction" renders corrected text + suggestions; "Submit for score" renders score/level/feedback and supports resubmission. (Behaviour.8, 9, 10)
- [ ] Real: each task runs a prep countdown then a recording countdown driven by `timing`; recording auto-stops at the limit; no guidance/correction is shown; "Submit exam"/last task routes to results with `elapsedMs`. (Behaviour.12, 13, 14)
- [ ] Results show per-task audio playback (range-streamed) + transcript + score/20 + NCLC (derived from the score) + feedback and an overall summary; reachable read-only via `GET /api/speaking/sessions/:id`. (Behaviour.15, 16)
- [ ] Evaluation/correction failures (`EVALUATION_FAILED` / `CORRECTION_FAILED`) show a retry affordance without losing the recording/transcript. (Behaviour.9, 10)

## Open questions
- **MediaRecorder MIME type.** Pick the recording MIME (`audio/webm;codecs=opus` is the common
  default) and align it with the server's transcription input (see speaking-evaluation Open questions
  on a possible `ffmpeg` transcode).
- **Auto-advance vs. manual "Next task" in real mode.** Default: auto-advance after upload completes;
  confirm whether a manual confirmation step is preferred. (Mirrors speaking-session Open questions.)
- **In-exam transcription latency.** Real mode shows a "transcribing…" state between tasks; confirm
  this is acceptable vs. deferring all transcription to `complete`.
- **Timer reuse.** The countdowns should reuse the existing quiz/Writing timer where possible, extended
  for the prep→record two-phase, per-task structure.

## Revision history
- 2026-06-17: Initial draft (Milestone 11).
- 2026-06-18: Approved (Milestone 11).
