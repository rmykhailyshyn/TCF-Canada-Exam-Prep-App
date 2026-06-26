# Spec: Progress Tracking + Session History

## Status

revised

> Base history model: Milestone 4 (reading/listening). **§Writing & speaking sessions** (Behaviour.9–12):
> Milestones 10–11 — draft pending approval. So that **all four sections' attempts are retained and
> analysable together**, writing and speaking sessions (with their per-task scores + feedback) appear
> in the same unified history.

> **Milestone 16 annotation — unscored online sessions.** AI scoring/transcription are
> local/full-runtime capabilities. A writing/speaking session completed on the deployed Worker
> (practice-only) has **no evaluation rows**, so its history `overallScore` is **`null`**, not `0` — it
> lists and renders as _unscored_ (no fabricated /20). `listSessions` and `getWriting/SpeakingSession`
> return `overallScore: null` whenever no task in the session is scored. See
> `docs/specs/content-deploy.md`.

## Goal

Give the user visibility into their past quiz sessions and overall progress. After
completing a session they see a results summary. A history page lists all past sessions
with key stats so the user can track improvement over time. Writing and speaking attempts are
recorded in the same history as reading/listening — with their scores and feedback persisted — so the
user can review and analyse every attempt across all four sections over time.

## Scope

- In scope:
  - Session results summary screen (shown immediately after a session ends)
  - Session history list: all past sessions across **all four sections** (reading, listening, writing,
    speaking), sortable by date
  - Per-session detail: section, mode, score, time taken (real mode), date
  - Score displayed as points scored / total possible (e.g. "387 / 699") for reading/listening, and as
    an overall /20 average for writing/speaking
  - Writing & speaking attempts retained with their **per-task scores + feedback** so historical
    attempts stay available for review and future analysis
- Out of scope:
  - Charts or trend graphs (may be added later)
  - Per-question result breakdown in the history list (covered by review-mode spec)
  - Deleting or resetting history
  - Cross-section aggregate analytics / trends (the data is retained for it, but computing and
    visualising trends is a later concern)

## Behaviour

### Results summary screen

1. Shown immediately after a session completes (timer expires, manual submit, or last
   question answered in learning mode).
2. Displays: section name, mode, and results that depend on mode:
   - **Learning mode:** difficulty label (e.g. "Intermediate (Q11–19, 15 pts)") and correct
     count (e.g. "7 / 9 correct"). No point score is shown.
   - **Real mode:** pointsScored / pointsPossible (e.g. "387 / 699"), correct count
     (e.g. "28 / 39 correct"), and time taken (e.g. "Completed in 43:12").
3. Two action buttons: "Review answers" (enters review mode) and "Back to home".

### Session history page

4. Accessible from the home / navigation menu.
5. Lists all completed sessions, most recent first.
6. Each row shows: date, section (Reading / Listening), mode (Learning / Real), and
   mode-specific score:
   - **Learning:** difficulty label (e.g. "Intermediate (Q11–19, 15 pts)") and correct
     count (e.g. "7 / 9").
   - **Real:** pointsScored / pointsPossible (e.g. "387 / 699"), correct count
     (e.g. "28 / 39"), and time taken ("—" replaced by actual time).
7. Clicking a session row opens the session detail / review mode for that session.
8. Abandoned sessions (completed_at is null) are not shown in the history list.

### Writing & speaking sessions

Writing (Milestone 10) and speaking (Milestone 11) sessions are stored in the same `sessions` table as
reading/listening, so they appear in the **same unified history list**, intermixed and newest-first.
Their result shape differs (free-text / spoken responses scored per task /20 + NCLC, not MCQ
correct/total or the 699-point map), so the history surfaces them as follows:

9. A writing/speaking history row shows: date, section ("Writing" / "Speaking"), mode ("Training" for
   the stored `learning` value / "Real"), and an **overall score** — the mean of the attempt's per-task
   /20 scores (e.g. "14 / 20 avg") with the count of tasks submitted (e.g. "3 / 3"). It does not show
   correct/total or `pointsScored`/`pointsPossible` (those are MCQ-only and are null for these rows).
10. Clicking a writing/speaking row opens that section's results/review view (the writing-session /
    speaking-session `GET …/sessions/:id` payload), showing each task's response text (writing) or
    recording playback + transcript (speaking), its per-task **score /20**, **NCLC level**, and the
    structured **feedback** (strengths / errors / improvements).
11. The per-task scores and feedback are **persisted** (`writing_evaluations` / `speaking_evaluations`,
    linked through `writing_responses` / `speaking_responses` to the session) and are never deleted by
    normal use, so any past attempt — its responses, scores, and feedback — remains available for
    later review and analysis.
12. Abandoned writing/speaking sessions (`completed_at` null) are excluded from the list, like
    reading/listening (Behaviour.8).

## Data model changes

No new tables in this spec. The unified history reads `sessions` (now also `section in
('writing','speaking')`), plus the writing/speaking response + evaluation tables defined in the
writing-session / writing-evaluation / speaking-session / speaking-evaluation specs. The reading/
listening history continues to rely on `sessions` + `question_results` (quiz-session spec).

## API contract

### GET /api/sessions

Return all completed sessions across **all four sections**, newest first.

```
Response: { "data": { "sessions": [{ "id": number, "section": string, "mode": string, "difficulty": string | null, "completedAt": string, "correct": number | null, "total": number | null, "pointsScored": number | null, "pointsPossible": number | null, "overallScore": number | null, "tasksSubmitted": number | null, "elapsedMs": number | null }] }, "error": null }
```

- `section` is one of `"reading" | "listening" | "writing" | "speaking"`.
- **Reading/listening rows:** `correct`/`total` set; `pointsScored`/`pointsPossible` set in real mode
  (null in learning); `overallScore`/`tasksSubmitted` null. `difficulty` is the slug for learning,
  `null` for real.
- **Writing/speaking rows:** `overallScore` is the mean per-task /20 (e.g. `14`) and `tasksSubmitted`
  the answered-task count; `correct`/`total`/`pointsScored`/`pointsPossible` are null; `difficulty` is
  null.
- `completedAt` is an ISO 8601 string (e.g. `"2026-06-05T14:23:00Z"`). All timestamp fields in API
  responses use ISO 8601 strings, not unix integers.

### GET /api/sessions/:id

Return a single reading/listening session with per-question results.

```
Response: { "data": { "session": Session, "results": QuestionResult[] }, "error": null }
```

Writing and speaking session detail is read through their own section endpoints
(`GET /api/writing/sessions/:id`, `GET /api/speaking/sessions/:id`), which carry the per-task
responses, scores, levels, and feedback (see writing-session / speaking-session). The history row's
click target routes to the appropriate detail view by `section` (Behaviour.10).

## Acceptance criteria

Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The results summary appears immediately when a session ends — timer expiry, manual submit, or the last learning-mode question answered. (Behaviour.1)
- [ ] The learning-mode summary shows the difficulty label and a correct/total count, and shows no point score. (Behaviour.2)
- [ ] The real-mode summary shows `pointsScored` / `pointsPossible`, a correct/total count, and the time taken. (Behaviour.2)
- [ ] The summary offers "Review answers" and "Back to home" actions. (Behaviour.3)
- [ ] The history page lists every completed session, most recent first. (Behaviour.4, 5)
- [ ] Each history row shows date, section, mode, and the mode-specific score (difficulty + correct/total for learning; points + correct/total + time for real). (Behaviour.6)
- [ ] Clicking a history row opens that session's detail / review mode. (Behaviour.7)
- [ ] Sessions with `completed_at` null (abandoned) never appear in the history list. (Behaviour.8)
- [ ] `GET /api/sessions` returns completed sessions newest-first, with ISO 8601 timestamp strings, `difficulty` null for real-mode rows, and `pointsScored`/`pointsPossible` null for learning-mode rows. (API contract)
- [ ] `GET /api/sessions/:id` returns the session together with its per-question results. (API contract)
- [ ] Writing and speaking sessions appear in the same `GET /api/sessions` history list as reading/listening, newest-first, with an `overallScore` (mean per-task /20) and `tasksSubmitted`, and MCQ-only fields null. (Behaviour.9; API contract)
- [ ] Clicking a writing/speaking history row opens that section's results/review view showing each task's response/transcript, per-task score /20 + NCLC level, and feedback. (Behaviour.10)
- [ ] A completed writing/speaking attempt's per-task scores and feedback remain persisted and retrievable after the session ends (not deleted by normal use), so past attempts stay available for analysis. (Behaviour.11)
- [ ] Abandoned writing/speaking sessions (`completed_at` null) do not appear in the history list. (Behaviour.12)

## Open questions

- ~~**Overall NCLC in the history row.**~~ **Resolved 2026-06-17:** the overall NCLC is **derived
  deterministically** from the overall /20 average using the shared score→NCLC map (writing-evaluation
  §Score → NCLC), so the history row can show both the average and its NCLC band without storing
  anything.
- **Cross-section trend analytics.** The data needed for trends is retained, but computing/plotting
  progress over time is out of scope here (see Scope).

## Revision history

- 2026-06-04: Initial draft
- 2026-06-05: Changed `completedAt` from `number` to ISO 8601 `string`; added timestamp
  serialisation rule for all API responses
- 2026-06-06: Replaced percentage score with `pointsScored`/`pointsPossible` (e.g. 387/699);
  kept correct/total count as secondary display; updated API shapes accordingly
- 2026-06-06: Learning mode shows correct/total only (no points); difficulty label shown
  in results summary and history row; `difficulty` and nullable points fields added to API
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
- 2026-06-08: Status moved draft → approved.
- 2026-06-17: **Milestones 10–11 revision.** Added §Writing & speaking sessions (Behaviour.9–12): the
  unified history list now includes writing and speaking attempts (`section in ('writing','speaking')`)
  with an `overallScore` (mean per-task /20) + `tasksSubmitted`, their detail opening the section's own
  results view (per-task score/NCLC/feedback), and explicit retention of per-task scores + feedback for
  future analysis. Extended `GET /api/sessions` with nullable `overallScore`/`tasksSubmitted` and made
  `correct`/`total` nullable. Status implemented → revised; the new behaviour is draft pending approval
  alongside the Milestone 10/11 specs.
