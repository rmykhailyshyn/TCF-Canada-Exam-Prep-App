# Spec: Quiz Session

## Status
draft

## Goal
Define the shared session model that underpins both reading and listening quiz modes.
A session represents one attempt at a section (reading or listening) in either learning
mode or real mode. This spec covers session lifecycle, mode behaviour, and result
persistence. UI specifics for each section are covered in their own specs.

## Scope
- In scope:
  - Session creation: section type, mode selection, question set
  - Learning mode behaviour (immediate per-answer feedback, no time limit)
  - Real mode behaviour (timed, no feedback during session)
  - Per-answer result recording
  - Score calculation at session end
  - Time tracking in real mode
  - Exam timing configuration (external config, not hardcoded)
- Out of scope:
  - UI layout for reading or listening (separate specs)
  - LLM explanation display (covered in review-mode and llm-enrichment specs)
  - Session history list page (covered in progress-tracking spec)
  - Pausing a real-mode session

## Behaviour

### Mode selection
1. Before starting a session the user selects a section (Reading or Listening) and a mode
   (Learning or Real).
2. The app displays the mode rules before the session begins:
   - Learning: no time limit, feedback after each answer.
   - Real: time-limited (see configuration), no feedback until session ends.
3. In learning mode, the user additionally selects a difficulty level to practice. The six
   levels map directly to the scoring bands and are labelled as follows:

   | Label | Questions | Points per correct answer |
   |---|---|---|
   | Beginner (Q1–4, 3 pts)            | 1 – 4   | 3  |
   | Elementary (Q5–10, 9 pts)         | 5 – 10  | 9  |
   | Intermediate (Q11–19, 15 pts)     | 11 – 19 | 15 |
   | Upper-Intermediate (Q20–29, 21 pts) | 20 – 29 | 21 |
   | Advanced (Q30–35, 26 pts)         | 30 – 35 | 26 |
   | Expert (Q36–39, 33 pts)           | 36 – 39 | 33 |

   The session will only include questions whose `sequence` falls within the selected band.

### Learning mode
4. The session presents one question at a time with no time constraint.
5. After the user selects an option and confirms their answer as final, the app immediately
   highlights the correct option and marks the user's choice as correct or incorrect.
6. If an LLM explanation exists for the question, it is shown at this point.
7. The user proceeds to the next question manually.
8. The session ends when all questions have been answered or the user explicitly quits.

### Real mode
8. A countdown timer is displayed throughout the session, initialised from the configured
   time limit for the section.
9. The user answers questions without receiving any feedback on correctness.
10. When the timer reaches zero, the session ends automatically and the user is taken to
    the results screen.
11. The user may also submit the session manually before the timer expires.
12. Elapsed time is recorded in the session record.

### Results
13. At session end:
    - **Learning mode:** shows correct answers and total questions in the selected difficulty
      band (e.g. "7 / 12 correct"). No point score is shown.
    - **Real mode:** shows pointsScored / pointsPossible (e.g. "387 / 699"), correct answer
      count (e.g. "28 / 39 correct"), and time taken (e.g. "Completed in 43:12").
14. The user is offered the option to enter Review mode.

### Scoring
15. Each question is worth a number of points determined by its `sequence` position within
    the exam (1-indexed, same map for both reading and listening sections):

    | Sequence range | Points per correct answer |
    |---|---|
    | 1 – 4   | 3  |
    | 5 – 10  | 9  |
    | 11 – 19 | 15 |
    | 20 – 29 | 21 |
    | 30 – 35 | 26 |
    | 36 – 39 | 33 |

    Maximum possible score per section: **699 points** (sum of all 39 questions at full value).
16. An incorrect or unanswered question contributes 0 points.
17. The backend computes `pointsScored` and `pointsPossible` at session completion by
    joining `question_results` with the question `sequence` values.

### Configuration
18. Exam time limits are read from a configuration file (`exam.config.json` at the repo
    root) and never hardcoded. Default values:
    - Reading: 60 minutes, 39 questions
    - Listening: 35 minutes, 39 questions

## Data model changes
```
sessions
  id           serial primary key
  section      text not null check (section in ('reading', 'listening'))
  mode         text not null check (mode in ('learning', 'real'))
  difficulty   text                 -- learning mode only; one of the six band slugs below; null in real mode
  started_at   timestamptz not null default now()
  completed_at timestamptz          -- null if abandoned
  elapsed_ms   integer              -- real mode only; null in learning mode

-- difficulty values (stored as slug, displayed with full label in UI):
--   'beginner'          → Q1–4,   3 pts
--   'elementary'        → Q5–10,  9 pts
--   'intermediate'      → Q11–19, 15 pts
--   'upper-intermediate'→ Q20–29, 21 pts
--   'advanced'          → Q30–35, 26 pts
--   'expert'            → Q36–39, 33 pts

question_results
  id           serial primary key
  session_id   integer not null references sessions(id)
  question_id  integer not null references questions(id)
  chosen_label text not null check (chosen_label in ('A', 'B', 'C', 'D'))
  is_correct   boolean not null
  answered_at  timestamptz not null default now()
```

## API contract

### POST /api/sessions
Start a new session.
```
Request:  { "section": "reading" | "listening", "mode": "learning" | "real", "difficulty"?: DifficultySlug, "questionIds"?: number[] }
Response: { "data": { "sessionId": number, "questions": Question[], "timeLimitMs": number | null }, "error": null }
Error (no answer key):    { "data": null, "error": { "code": "ANSWER_KEY_MISSING", "message": "..." } }
Error (bad difficulty):   { "data": null, "error": { "code": "INVALID_DIFFICULTY", "message": "..." } }
Error (band mismatch):    { "data": null, "error": { "code": "QUESTIONS_OUT_OF_BAND", "message": "..." } }
```
`difficulty` is required when `mode` is `"learning"` and must be one of: `"beginner"`,
`"elementary"`, `"intermediate"`, `"upper-intermediate"`, `"advanced"`, `"expert"`.
It is ignored (and may be omitted) when `mode` is `"real"`.
The returned `questions` array is filtered to the selected difficulty band's sequence range.

`questionIds` is an optional filter used by the review-mode retry flow (see review-mode spec).
When provided in learning mode it further restricts the session to that subset, and **every
id must belong to the selected difficulty band** — otherwise the endpoint returns
`QUESTIONS_OUT_OF_BAND`. (This is why retry sessions are grouped per band: one retry session
per band, each carrying that band's `difficulty`.)

The endpoint returns `ANSWER_KEY_MISSING` if any question **in the resolved question set**
(the selected difficulty band in learning mode, or the whole section in real mode) has
`is_correct = false` for all of its options (i.e. no answer key has been imported yet).
This prevents sessions from starting in an indeterminate state, while still allowing a user
to practise a band whose answer key is ready even if other bands have not been imported.

### POST /api/sessions/:id/answers
Submit an answer for a question within a session.
```
Request:  { "questionId": number, "chosenLabel": "A" | "B" | "C" | "D" }
Response (learning): {
  "data": {
    "isCorrect": boolean,
    "correctLabel": "A" | "B" | "C" | "D",
    "explanation": {
      "correctReason": string,
      "optionAReason": string,
      "optionBReason": string,
      "optionCReason": string,
      "optionDReason": string
    } | null   -- null when no LLM explanation has been generated yet
  },
  "error": null
}
Response (real): { "data": { "recorded": true }, "error": null }
```
The `explanation` shape mirrors the `explanations` table defined in the llm-enrichment spec.
The backend fetches it in a single JOIN rather than requiring a separate client request.

### POST /api/sessions/:id/complete
Mark a session as completed (real mode manual submit or timer expiry signal, or learning
mode when the last question is answered / the user quits).
```
Request:  { "elapsedMs": number | null }
Response: { "data": { "correct": number, "total": number, "pointsScored": number | null, "pointsPossible": number | null }, "error": null }
```
`elapsedMs` is `null` in learning mode (no timer). In **real mode**, `pointsPossible` is
always 699 for a full 39-question section and `pointsScored` is the sum of point values for
correctly answered questions, looked up by question `sequence`. In **learning mode**,
`pointsScored` and `pointsPossible` are both `null` (learning mode tracks correct/total only).

## Open questions
- Should questions within a session be presented in a fixed order (by import order) or
  randomised? TCF Canada uses a fixed order, so fixed is the safe default — confirm before
  implementing shuffle logic.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: POST /api/sessions now returns ANSWER_KEY_MISSING if section has no answer key
- 2026-06-05: POST /api/sessions/:id/answers explanation field changed from `string | null`
  to the full Explanation object shape (aligned with llm-enrichment spec)
- 2026-06-06: Added weighted scoring (§Scoring); replaced `score` percentage with
  `pointsScored`/`pointsPossible` in POST /api/sessions/:id/complete response
- 2026-06-06: Added difficulty filter for learning mode (§Mode selection Behaviour.3);
  learning mode results show correct/total only, no points; `difficulty` column added to
  sessions table; POST /api/sessions gains optional `difficulty` field
- 2026-06-07: Consistency pass — fixed `optionAReason` typo; made `elapsedMs` and points
  nullable in POST /complete (learning mode); added `questionIds` filter + band-subset rule
  (`QUESTIONS_OUT_OF_BAND`) to POST /api/sessions; scoped `ANSWER_KEY_MISSING` to the
  resolved question set (selected band in learning mode)
