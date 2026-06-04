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

### Layout
1. The player (audio controls + subtitle overlay) occupies the upper portion of the screen.
2. The question text and four answer options are displayed below the player.
3. A question counter ("Question 5 of 39") is visible at all times.
4. Real mode only: a countdown timer is shown in the header.

### Answering a question
5. The user may play, pause, and replay the audio clip before selecting an option.
6. The user selects one option (A–D); it is visually highlighted as a pending selection.
7. A "Confirm answer" button becomes active once an option is selected.
8. The user clicks "Confirm answer" to finalise. This action cannot be undone.

### Learning mode feedback
9. After confirming, the correct option is highlighted in green; a wrong choice is
   highlighted in red.
10. If an LLM explanation exists for the question, it is displayed below the options.
11. A "Next question" button appears; the user proceeds manually.

### Real mode
12. No feedback is shown after confirming an answer.
13. After confirming, the app advances automatically to the next question.
14. When the timer reaches zero, the session is submitted automatically.
15. The user may click "Submit exam" to end the session early; a confirmation dialog is shown.

### End of session
16. After the final question (or timer expiry / manual submit), the results screen is shown
    as defined in quiz-session spec §Behaviour.13–14.

## Data model changes
None — handled by quiz-session spec.

## API contract
Consumes endpoints defined in quiz-session spec and listening-player spec.

## Open questions
- None at this time.

## Revision history
- 2026-06-04: Initial draft
