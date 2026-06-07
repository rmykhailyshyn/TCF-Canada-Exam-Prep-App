# Spec: Listening Quiz UI

## Status
draft

## Goal
Provide a quiz interface for the listening comprehension section. The user listens to an
audio clip (with subtitle overlay) and answers one multiple-choice question per clip.
The UI supports both learning mode and real mode as defined in the quiz-session spec,
and embeds the listening player defined in the listening-player spec.

## Scope
- In scope:
  - Listening player embedded above the question and options
  - 4-option (A–D) single-select multiple-choice interaction
  - Learning mode: confirm-answer step, correct/incorrect highlight, LLM explanation display
  - Real mode: countdown timer, no per-answer feedback, auto-advance after confirming
  - Navigation between questions within a session
  - Session end / results screen hand-off
- Out of scope:
  - Session lifecycle and result persistence (quiz-session spec)
  - Player internals (listening-player spec)
  - LLM explanation generation (llm-enrichment spec)
  - Review mode UI (review-mode spec)

## Behaviour

### Session setup
1. Before the quiz begins, the user sees a setup screen where they choose mode (Learning /
   Real). In learning mode, a second step presents a difficulty picker with six options:
   - Beginner (Q1–4, 3 pts)
   - Elementary (Q5–10, 9 pts)
   - Intermediate (Q11–19, 15 pts)
   - Upper-Intermediate (Q20–29, 21 pts)
   - Advanced (Q30–35, 26 pts)
   - Expert (Q36–39, 33 pts)
2. The "Start" button is disabled until a difficulty is selected (learning mode) or until
   mode is confirmed (real mode).

### Layout
3. The player (audio controls + subtitle overlay) occupies the upper portion of the screen.
4. The question text and four answer options are displayed below the player.
5. A question counter ("Question 5 of 6" — reflects the filtered band size in learning
   mode, or "Question 5 of 39" in real mode) is visible at all times.
6. Real mode only: a countdown timer is shown in the header.

### Answering a question
7. The user may play, pause, and replay the audio clip before selecting an option.
8. The user selects one option (A–D); it is visually highlighted as a pending selection.
9. A "Confirm answer" button becomes active once an option is selected.
10. The user clicks "Confirm answer" to finalise. This action cannot be undone.

### Learning mode feedback
11. After confirming, the correct option is highlighted in green; a wrong choice is
    highlighted in red.
12. If an LLM explanation exists for the question, it is displayed below the options.
13. A "Next question" button appears; the user proceeds manually.

### Real mode
14. No feedback is shown after confirming an answer.
15. After confirming, the app advances automatically to the next question.
16. When the timer reaches zero, the session is submitted automatically.
17. The user may click "Submit exam" to end the session early; a confirmation dialog is shown.

### End of session
18. After the final question (or timer expiry / manual submit), the results screen is shown
    as defined in quiz-session spec §Behaviour.13.

## Data model changes
None — handled by quiz-session spec.

## API contract
Consumes endpoints defined in quiz-session spec and listening-player spec.

## Open questions
- None at this time.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-06: Added session setup screen with difficulty picker (learning mode); question
  counter now reflects filtered band size in learning mode
