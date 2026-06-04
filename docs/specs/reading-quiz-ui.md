# Spec: Reading Quiz UI

## Status
draft

## Goal
Provide a quiz interface for the reading comprehension section. The user reads a passage
and answers multiple-choice questions linked to it. The UI supports both learning mode
(immediate feedback) and real mode (timed, no feedback), as defined in the quiz-session spec.

## Scope
- In scope:
  - Passage display alongside question and answer options
  - 4-option (A–D) single-select multiple-choice interaction
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

### Layout
1. The screen is split: passage text on the left (or top on narrow viewports), question
   panel on the right (or bottom).
2. The passage text is scrollable independently of the question panel.
3. A question counter ("Question 3 of 39") is visible at all times.
4. Real mode only: a countdown timer is visible in the header throughout the session.

### Answering a question
5. The user selects one of the four options (A–D) by clicking or tapping it.
6. The selected option is visually highlighted as a pending selection; no answer is
   recorded yet.
7. A "Confirm answer" button becomes active once an option is selected.
8. The user clicks "Confirm answer" to finalise their choice. This action cannot be undone.

### Learning mode feedback
9. After confirming, the correct option is highlighted in green; if the user's choice was
   wrong it is highlighted in red.
10. If an LLM explanation exists for the question, it is displayed below the options. The
    explanation covers why the correct answer is right and why each incorrect option is wrong.
11. A "Next question" button appears; the user proceeds manually.

### Real mode
12. Options are selectable and confirmable with no feedback shown.
13. After confirming, the app advances automatically to the next question.
14. When the timer reaches zero, the session is submitted automatically.
15. The user may click "Submit exam" to end the session early; a confirmation dialog is
    shown before submission.

### End of session
16. After the final question (or timer expiry / manual submit), the results screen is shown
    as defined in quiz-session spec §Behaviour.13–14.

## Data model changes
None — handled by quiz-session spec.

## API contract
Consumes endpoints defined in quiz-session spec.

## Open questions
- None at this time.

## Revision history
- 2026-06-04: Initial draft
