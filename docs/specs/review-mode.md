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
8. Incorrect questions are **grouped by difficulty band** (using each question's `sequence`,
   per quiz-session spec §Scoring). Retry produces **one learning-mode session per band**
   that has at least one incorrect answer — each session contains only the incorrect
   questions from that band and carries that band's `difficulty`.
9. If the wrong answers span more than one band, the user is shown the list of affected
   bands (e.g. "Intermediate (3), Advanced (1)") and starts them one at a time; a single
   affected band starts its retry session directly.
10. Each retry session is recorded as a normal learning-mode session in history, labelled
    with its band's difficulty like any other learning session.

## Data model changes
None — relies on `sessions`, `question_results`, `questions`, `options`, and
`explanations` (defined in llm-enrichment spec).

## API contract
Consumes `GET /api/sessions/:id` defined in progress-tracking spec.

### POST /api/sessions (retry)
Reuses the session creation endpoint from quiz-session spec. Because retries are grouped
per band (Behaviour.8), each retry call carries both the band's `difficulty` and the
`questionIds` for that band's incorrect answers. Every id in `questionIds` must belong to
the given `difficulty` band, or the endpoint returns `QUESTIONS_OUT_OF_BAND`.
```
Request:  { "section": "reading" | "listening", "mode": "learning", "difficulty": DifficultySlug, "questionIds": number[] }
Response: { "data": { "sessionId": number, "questions": Question[], "timeLimitMs": null }, "error": null }
```
Retrying wrong answers from multiple bands means issuing one such call per affected band.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] Review mode is reachable from the results summary "Review answers" button and from a history session row, and is read-only — no answer can be changed. (Behaviour.1, 2)
- [ ] All questions from the session are shown in order, each with its text (plus passage excerpt for reading), all four options, the user's chosen option (red if wrong, green if correct), and the correct option marked green. (Behaviour.3, 4)
- [ ] Learning-mode sessions show the LLM explanation below a question when one exists; real-mode sessions never show explanations. (Behaviour.5, 6)
- [ ] A "Retry incorrect questions" button is shown only when the session has at least one incorrect answer. (Behaviour.7)
- [ ] Incorrect questions are grouped by difficulty band, and retry produces one learning-mode session per affected band containing only that band's incorrect questions and carrying that band's `difficulty`. (Behaviour.8)
- [ ] When wrong answers span multiple bands, the affected bands and counts are listed and started one at a time; a single affected band starts its retry directly. (Behaviour.9)
- [ ] Each retry `POST /api/sessions` carries the band's `difficulty` and that band's `questionIds`; any id outside the band yields `QUESTIONS_OUT_OF_BAND`. (Behaviour.8; API contract)
- [ ] Each retry session is recorded in history as a normal learning-mode session labelled with its band's difficulty. (Behaviour.10)

## Open questions
- Should the passage image be shown in review mode for reading questions, or is the
  OCR-extracted text sufficient? Showing the image requires serving the original PNG,
  which means the import path must be stable.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-07: Retry now groups incorrect questions by difficulty band — one learning-mode
  session per affected band, each carrying that band's `difficulty`; retry API gains the
  required `difficulty` field and the band-subset constraint (aligned with quiz-session spec)
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
