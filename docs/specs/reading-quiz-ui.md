# Spec: Reading Quiz UI

## Status
approved

> The base UI (Milestone 2) is `implemented`. The **passage image + OCR text display**
> (Behaviour.3a–3c, the `GET /api/questions/:id/passage-image` endpoint) is a Milestone 8
> revision, **approved 2026-06-13** and ready to implement; status returns to `implemented`
> once the code ships.

## Goal
Provide a quiz interface for the reading comprehension section. The user reads a passage and answers multiple-choice questions linked to it. The UI supports both learning mode (immediate feedback) and real mode (timed, no feedback), as defined in the quiz-session spec.

## Scope
- In scope:
  - Passage display alongside question and answer options
  - Passage panel shows the **original passage image** with the **OCR'd passage text directly below it**
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
3. The screen is split: the passage panel on the left (or top on narrow viewports), question panel on the right (or bottom).
3a. Within the passage panel, the **original passage image is displayed on top** and the **OCR'd passage text directly below it** (image first, then text). The image is the source PNG that the passage was OCR'd from (reading-import spec — `passages.source_file`); the text is `passages.text`. Showing both lets the user read the authoritative original and fall back to the searchable/selectable OCR text.
3b. The passage image is rendered scaled to the panel width (preserving aspect ratio); it is not cropped. Both the image and the text scroll together within the passage panel.
3c. If the passage image cannot be loaded (file missing on disk — e.g. a question bank imported without its media), the panel degrades gracefully to **OCR text only**, with no broken-image placeholder.
4. The passage panel is scrollable independently of the question panel.
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
None — the passage image path (`passages.source_file`) and OCR text (`passages.text`) already
exist from the reading-import spec. No schema change.

## API contract
Consumes the session endpoints defined in quiz-session spec, plus one new read-only endpoint to
serve the passage image bytes:

### GET /api/questions/:id/passage-image
Streams the original passage image for the question's linked passage (analogous to the listening
`GET /api/questions/:id/audio` route). The image is read from the linked `passages.source_file`
path on disk and served with the appropriate `Content-Type` (`image/png` / `image/jpeg`).
```
Response (200): <binary image bytes>, Content-Type: image/png | image/jpeg
Error (no passage / not a reading question): 404  { "data": null, "error": { "code": "PASSAGE_IMAGE_NOT_FOUND", "message": "..." } }
Error (file missing on disk):                404  { "data": null, "error": { "code": "PASSAGE_IMAGE_NOT_FOUND", "message": "..." } }
```
The client renders `<img src="/api/questions/:id/passage-image">` and, on the image's `error`
event (any 404), falls back to OCR-text-only per Behaviour.3c — so the session payload needs no
new field (presence is probed by attempting to load the image).

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The setup screen lets the user pick mode (Learning / Real); in learning mode the six labelled difficulty bands are presented. (Behaviour.1)
- [ ] The Start button is disabled until a difficulty is selected (learning) or the mode is confirmed (real). (Behaviour.2)
- [ ] The layout splits passage (left, or top on narrow viewports) and question panel (right, or bottom), and the passage panel scrolls independently of the question panel. (Behaviour.3, 4)
- [ ] The passage panel renders the original passage image on top with the OCR'd passage text directly below it; the image is scaled to panel width preserving aspect ratio. (Behaviour.3a, 3b)
- [ ] `GET /api/questions/:id/passage-image` returns the image bytes for a reading question's passage with the correct `Content-Type`, and 404 `PASSAGE_IMAGE_NOT_FOUND` when there is no passage image or the file is missing on disk. (API contract)
- [ ] When the passage image fails to load, the panel shows OCR text only with no broken-image placeholder. (Behaviour.3c)
- [ ] The question counter shows the filtered band size in learning mode (e.g. "Question 3 of 9") and "Question N of 39" in real mode. (Behaviour.5)
- [ ] A countdown timer is shown in the header in real mode. (Behaviour.6)
- [ ] Selecting one of A–D marks a pending selection without recording an answer; "Confirm answer" becomes active and finalises the choice, which cannot be undone. (Behaviour.7, 8, 9, 10)
- [ ] Learning mode: after confirming, the correct option is highlighted green and a wrong pick red; an explanation (when present) appears below the options; a "Next question" button advances manually. (Behaviour.11, 12, 13)
- [ ] Real mode: no per-answer feedback is shown and the app auto-advances after confirming. (Behaviour.14, 15)
- [ ] Real mode: the timer reaching zero auto-submits the session, and "Submit exam" shows a confirmation dialog before ending early. (Behaviour.16, 17)
- [ ] After the final question, manual submit, or timer expiry, the results screen (quiz-session §Behaviour.13) is shown. (Behaviour.18)

## Open questions
- Should review mode (review-mode spec) also show the passage image above the OCR excerpt? The
  current review-mode spec shows a passage *excerpt* (text). Out of scope for this revision —
  flagged for a follow-up if desired.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-06: Added session setup screen with difficulty picker (learning mode); question counter now reflects filtered band size in learning mode
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
- 2026-06-08: Status moved draft → approved.
- 2026-06-08: Implemented in Milestone 2 — setup screen (mode + difficulty), split passage/question
  layout, confirm-answer flow, learning feedback + explanation slot, real-mode countdown with
  auto/manual submit + confirmation dialog, and the results hand-off. Covered by render smoke
  tests; typecheck/lint/build green. Status approved → implemented.
- 2026-06-12: **Milestone 8 revision.** Passage panel now shows the original passage image on top
  with the OCR'd text directly below (Behaviour.3a–3c). Added read-only `GET
  /api/questions/:id/passage-image` (streams `passages.source_file`, 404
  `PASSAGE_IMAGE_NOT_FOUND`), graceful fallback to text-only when the image is missing, and
  matching acceptance criteria. No schema change (image path + OCR text already exist from
  reading-import). Status implemented → revised; the new behaviour is draft pending approval.
- 2026-06-13: Passage image + OCR text display revision approved (Milestone 8). Status revised →
  approved; ready to implement.
