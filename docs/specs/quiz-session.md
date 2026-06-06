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

### Learning mode
3. The session presents one question at a time with no time constraint.
4. After the user selects an option and confirms their answer as final, the app immediately
   highlights the correct option and marks the user's choice as correct or incorrect.
5. If an LLM explanation exists for the question, it is shown at this point.
6. The user proceeds to the next question manually.
7. The session ends when all questions have been answered or the user explicitly quits.

### Real mode
8. A countdown timer is displayed throughout the session, initialised from the configured
   time limit for the section.
9. The user answers questions without receiving any feedback on correctness.
10. When the timer reaches zero, the session ends automatically and the user is taken to
    the results screen.
11. The user may also submit the session manually before the timer expires.
12. Elapsed time is recorded in the session record.

### Results
13. At session end, the app shows: total questions, correct answers, incorrect answers,
    score as a percentage, and (real mode only) time taken.
14. The user is offered the option to enter Review mode.

### Configuration
15. Exam time limits are read from a configuration file (`exam.config.json` at the repo
    root) and never hardcoded. Default values:
    - Reading: 60 minutes, 39 questions
    - Listening: 35 minutes, 39 questions

## Data model changes
```
sessions
  id           serial primary key
  section      text not null check (section in ('reading', 'listening'))
  mode         text not null check (mode in ('learning', 'real'))
  started_at   timestamptz not null default now()
  completed_at timestamptz          -- null if abandoned
  elapsed_ms   integer              -- real mode only; null in learning mode

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
Request:  { "section": "reading" | "listening", "mode": "learning" | "real" }
Response: { "data": { "sessionId": number, "questions": Question[], "timeLimitMs": number | null }, "error": null }
```

### POST /api/sessions/:id/answers
Submit an answer for a question within a session.
```
Request:  { "questionId": number, "chosenLabel": "A" | "B" | "C" | "D" }
Response (learning): { "data": { "isCorrect": boolean, "correctLabel": "A"|"B"|"C"|"D", "explanation": string | null }, "error": null }
Response (real):     { "data": { "recorded": true }, "error": null }
```

### POST /api/sessions/:id/complete
Mark a session as completed (real mode manual submit or timer expiry signal).
```
Request:  { "elapsedMs": number }
Response: { "data": { "score": number, "correct": number, "total": number }, "error": null }
```

## Open questions
- Should questions within a session be presented in a fixed order (by import order) or
  randomised? TCF Canada uses a fixed order, so fixed is the safe default — confirm before
  implementing shuffle logic.

## Revision history
- 2026-06-04: Initial draft
