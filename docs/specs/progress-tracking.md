# Spec: Progress Tracking + Session History

## Status
implemented

## Goal
Give the user visibility into their past quiz sessions and overall progress. After
completing a session they see a results summary. A history page lists all past sessions
with key stats so the user can track improvement over time.

## Scope
- In scope:
  - Session results summary screen (shown immediately after a session ends)
  - Session history list: all past sessions, sortable by date
  - Per-session detail: section, mode, score, time taken (real mode), date
  - Score displayed as points scored / total possible (e.g. "387 / 699")
- Out of scope:
  - Charts or trend graphs (may be added later)
  - Per-question result breakdown in the history list (covered by review-mode spec)
  - Deleting or resetting history

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

## Data model changes
No new tables — relies on `sessions` and `question_results` defined in quiz-session spec.

## API contract

### GET /api/sessions
Return all completed sessions, newest first.
```
Response: { "data": { "sessions": [{ "id": number, "section": string, "mode": string, "difficulty": string | null, "completedAt": string, "correct": number, "total": number, "pointsScored": number | null, "pointsPossible": number | null, "elapsedMs": number | null }] }, "error": null }
```
`difficulty` is the slug (e.g. `"intermediate"`) for learning-mode sessions, `null` for real.
`pointsScored` and `pointsPossible` are `null` for learning-mode sessions.
`completedAt` is an ISO 8601 string (e.g. `"2026-06-05T14:23:00Z"`). All timestamp fields
in API responses use ISO 8601 strings, not unix integers.

### GET /api/sessions/:id
Return a single session with per-question results.
```
Response: { "data": { "session": Session, "results": QuestionResult[] }, "error": null }
```

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

## Open questions
- None at this time.

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
