# Spec: Reading Quiz UI

## Status
draft

## Goal
Provide a quiz interface for the reading comprehension section. The user reads a passage and answers multiple-choice questions linked to it. The UI supports both learning mode (immediate feedback) and real mode (timed, no feedback), as defined in the quiz-session spec.

## Scope
- In scope:
  - Passage display alongside question and answer options
  - 4-option (A–D) single-select multiple-choice nteraction
  - Learning mode: confirm-answer step, correct/incorrect highlight, LLM explanation display
  - Real mode: countdown timer, no per-answer feedback
  - Navigation between questions within a session
  - Session end / results screen hand-off
- Out of scope:
  - Session lifecycle and result persistence (quiz-session spec)
  - LLM explanation generation (llm-enrichment spec)
  - Review mode UI (review-mode spec)
  - Listening player (listening-quiz-ui spec)

## Behaviour

### Session setup
1. Before the quiz begins, the user sees a setup screen where they choose mode (Learning / Real). In learning mode, a second step presents a difficulty picker with six options:
   - Beginner (Q1–4, 3 pts)
   - Elementary (Q5–10, 9 pts)
   - Intermediate (Q11–19, 15 pts)
   - Upper-Intermediate (Q20–29, 21 pts)
   - Advanced (Q30–35, 26 pts)
   - Expert (Q36–39, 33 pts)
2. The "Start" button is disabled until a difficulty is selected (learning mode) or until  mode is confirmed (real mode).

### Layout
3. The screen is split: passage text on the left (or top on narrow viewports), question panel on the right (or bottom).
4. The passage text is scrollable independently of the question panel.
5. A question counter ("Question 3 of 9" — reflects the filtered band size in learning mode, or "Question 3 of 39" in real mode) is visible at all times.
6. Real mode only: a countdown timer is visible in the header throughout the session.

### Answering a question
7. The user selects one of the four options (A–D) by clicking or tapping it.
8. The selected option is visually highlighted as a pending selection; no answer is recorded yet.
9. A "Confirm answer" button becomes active once an option is selected.
10. The user clicks "Confirm answer" to finalise their choice. This action cannot be undone.

### Learning mode feedback
11. After confirming, the correct option is highlighted in green; if the user's choice was  wrong it is highlighted in red.
12. If an LLM explanation exists for the question, it is displayed below the options. The explanation covers why the correct answer is right and why each incorrect option is wrong.
13. A "Next question" button appears; the user proceeds manually.

### Real mode
14. Options are selectable and confirmable with no feedback shown.
15. After confirming, the app advances automatically to the next question.
16. When the timer reaches zero, the session is submitted automatically.
17. The user may click "Submit exam" to end the session early; a confirmation dialog is
    shown before submission.

### End of session
18. After the final question (or timer expiry / manual submit), the results screen is shown
    as defined in quiz-session spec §Behaviour.13.

## Data model changes
None — handled by quiz-session spec.

## API contract
Consumes endpoints defined in quiz-session spec.

## Open questions
- None at this time.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-06: Added session setup screen with difficulty picker (learning mode); question counter now reflects filtered band size in learning mode
