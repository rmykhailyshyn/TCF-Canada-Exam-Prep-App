# Spec: Progress Tracking + Session History

## Status
draft

## Goal
Give the user visibility into their past quiz sessions and overall progress. After
completing a session they see a results summary. A history page lists all past sessions
with key stats so the user can track improvement over time.

## Scope
- In scope:
  - Session results summary screen (shown immediately after a session ends)
  - Session history list: all past sessions, sortable by date
  - Per-session detail: section, mode, score, time taken (real mode), date
  - Score displayed as number correct / total and as a percentage
- Out of scope:
  - Charts or trend graphs (may be added later)
  - Per-question result breakdown in the history list (covered by review-mode spec)
  - Deleting or resetting history

## Behaviour

### Results summary screen
1. Shown immediately after a session completes (timer expires, manual submit, or last
   question answered in learning mode).
2. Displays: section name, mode, score (e.g. "28 / 39 — 72%"), and for real mode the
   time taken (e.g. "Completed in 43:12").
3. Two action buttons: "Review answers" (enters review mode) and "Back to home".

### Session history page
4. Accessible from the home / navigation menu.
5. Lists all completed sessions, most recent first.
6. Each row shows: date, section (Reading / Listening), mode (Learning / Real), score
   (correct / total, percentage), and time taken (real mode only — shown as "—" in
   learning mode).
7. Clicking a session row opens the session detail / review mode for that session.
8. Abandoned sessions (completed_at is null) are not shown in the history list.

## Data model changes
No new tables — relies on `sessions` and `question_results` defined in quiz-session spec.

## API contract

### GET /api/sessions
Return all completed sessions, newest first.
```
Response: { "data": { "sessions": [{ "id": number, "section": string, "mode": string, "completedAt": string, "correct": number, "total": number, "score": number, "elapsedMs": number | null }] }, "error": null }
```
`completedAt` is an ISO 8601 string (e.g. `"2026-06-05T14:23:00Z"`). All timestamp fields
in API responses use ISO 8601 strings, not unix integers.

### GET /api/sessions/:id
Return a single session with per-question results.
```
Response: { "data": { "session": Session, "results": QuestionResult[] }, "error": null }
```

## Open questions
- None at this time.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: Changed `completedAt` from `number` to ISO 8601 `string`; added timestamp
  serialisation rule for all API responses
