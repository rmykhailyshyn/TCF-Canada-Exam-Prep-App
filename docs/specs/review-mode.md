# Spec: Review Mode

## Status
draft

## Goal
After completing a session, allow the user to review every question they answered,
see whether they were right or wrong, and retry only the questions they got wrong.
In learning mode, LLM explanations (if available) are shown. This gives the user a
focused post-session learning loop.

## Scope
- In scope:
  - Per-question review: user's answer, correct answer, correct/incorrect indicator
  - LLM explanations shown in learning mode (if generated)
  - Retry session: start a new session containing only incorrectly answered questions
  - Accessible from the results summary screen and from session history
- Out of scope:
  - Editing or correcting the stored answer
  - LLM explanation generation (llm-enrichment spec)
  - Displaying the audio player in review mode for listening questions (nice-to-have, not in initial scope)

## Behaviour

### Entering review mode
1. The user enters review mode from the results summary screen ("Review answers" button)
   or by clicking a session row in the history page.
2. Review mode is read-only — no answers can be changed.

### Question review list
3. All questions from the session are shown in order.
4. Each question shows:
   - The question text (and passage excerpt for reading questions).
   - All four options (A–D) with their text.
   - The user's chosen option, marked with a red indicator if wrong or a green indicator
     if correct.
   - The correct option, always marked with a green indicator.
5. In learning mode, if an LLM explanation exists for the question, it is displayed
   below the options. The explanation covers why the correct answer is right and why each
   incorrect option is wrong.
6. In real mode, explanations are not shown (real mode simulates exam conditions;
   explanations are a learning-mode feature).

### Retry
7. A "Retry incorrect questions" button is shown if the session contains at least one
   incorrect answer.
8. Clicking it starts a new learning-mode session containing only the incorrectly
   answered questions from the reviewed session, in the same section.
9. The retry session is recorded as a normal session in history.

## Data model changes
None — relies on `sessions`, `question_results`, `questions`, `options`, and
`explanations` (defined in llm-enrichment spec).

## API contract
Consumes `GET /api/sessions/:id` defined in progress-tracking spec.

### POST /api/sessions (retry)
Reuses the session creation endpoint from quiz-session spec with an additional
optional `questionIds` filter:
```
Request:  { "section": "reading" | "listening", "mode": "learning", "questionIds": number[] }
Response: { "data": { "sessionId": number, "questions": Question[], "timeLimitMs": null }, "error": null }
```

## Open questions
- Should the passage image be shown in review mode for reading questions, or is the
  OCR-extracted text sufficient? Showing the image requires serving the original PNG,
  which means the import path must be stable.

## Revision history
- 2026-06-04: Initial draft
