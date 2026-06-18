# Spec: On-Screen Virtual Keyboard (French accents)

## Status
approved

> Milestone 12. A frontend input aid for typing French special characters (é, à, ç, …) that a
> non-French physical keyboard makes awkward — mirroring the on-screen keyboard provided by the real
> TCF Canada exam software. Primarily consumed by the Writing editor (writing-ui §Editor); designed as
> a reusable component for any future French text input. Augments writing-ui without changing its
> approved behaviour.

## Goal
Let the user insert French accented and special characters into a text response by clicking on-screen
buttons, exactly as the real TCF Canada exam software offers during the *Expression écrite*. This
removes the dependency on a French (AZERTY) physical keyboard or OS-level dead-key/compose sequences,
so a candidate on any keyboard layout can produce correct French orthography while writing.

## Scope
- In scope:
  - A reusable on-screen virtual keyboard / accent toolbar component (React) that renders clickable
    French special characters and inserts the chosen glyph into the associated text input at the
    caret.
  - Integration into the **Writing editor** (writing-ui §Editor): the keyboard is shown adjacent to
    each task's `<textarea>`, in **both** training and real modes (the real TCF software provides it
    during the timed exam, so it is an input aid, not exam assistance).
  - Lowercase and (via a shift/caps toggle) uppercase accented variants, plus the common French
    punctuation glyphs (guillemets, etc.).
  - Caret-aware insertion that preserves focus, supports the textarea's normal typing/undo, and
    triggers the same autosave + word-count paths as physical typing.
  - Keyboard- and screen-reader-accessible buttons.
- Out of scope:
  - A full soft AZERTY keyboard for all letters/numbers (only the special characters that a standard
    layout lacks are provided; ordinary letters are typed normally).
  - Any backend, data-model, or scoring change — this is presentation/input only.
  - The Speaking section (it captures voice, not typed text) and the reading/listening MCQ UIs.
  - IME/handwriting input, predictive text, or spell-check.

## Behaviour
1. In the Writing editor, an on-screen virtual keyboard (accent toolbar) is shown next to each task's
   `<textarea>`, available in both training and real modes.
2. Clicking a character button inserts that glyph into the **focused** task's textarea at the current
   caret position (replacing any active selection), then returns focus to the textarea with the caret
   positioned immediately after the inserted glyph — the user does not lose their place.
3. Inserted characters behave exactly like typed ones: they participate in the textarea's native undo
   history and trigger the same **word-count** update and **autosave** (`PUT …/responses/:taskNumber`)
   as physical typing (writing-ui §Editor; writing-session).
4. The keyboard provides the exact character set of the official TCF Canada exam keyboard — a **4×4
   grid** of 16 keys, in this order (confirmed from the real software):

   | | | | |
   |---|---|---|---|
   | é | è | ê | ë |
   | à | â | ù | û |
   | ô | î | ï | ç |
   | œ | æ | « | » |

   Below the grid sits a **shift / caps toggle** key (rendered as `⇧ abc`, matching the official UI).
   Toggling it switches the 14 letter keys between lowercase and their **uppercase** variants
   (`É È Ê Ë À Â Ù Û Ô Î Ï Ç Œ Æ`); the guillemets `«` `»` are unaffected by the toggle.
5. The layout and character set **match the official TCF Canada exam software** (the 4×4 grid above
   plus the `⇧ abc` toggle), so the practice environment matches the real exam.
6. The buttons are accessible: each is focusable and operable by keyboard (Enter/Space), has an
   accessible label naming the character, and the inserted French text continues to live inside the
   `lang="fr"`-tagged textarea content (M9 a11y convention).
7. The keyboard never steals focus such that normal typing is interrupted — after any insertion the
   textarea regains focus, and the toolbar is usable interchangeably with the physical keyboard.

## Data model changes
None. Frontend-only.

## API contract
None. The component reads from and writes to the existing Writing editor state; it introduces no new
endpoints and changes none. Inserted text flows through the existing writing-session draft/autosave
endpoints unchanged.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] The Writing editor shows an on-screen accent keyboard next to each task's textarea in both training and real modes. (Behaviour.1)
- [ ] Clicking a character inserts it at the caret (replacing any selection) and returns focus to the textarea with the caret after the glyph. (Behaviour.2)
- [ ] An inserted character updates the word count and triggers autosave the same way typed input does, and is undoable. (Behaviour.3)
- [ ] The keyboard renders the exact 16-key 4×4 grid (`é è ê ë / à â ù û / ô î ï ç / œ æ « »`) with a `⇧ abc` shift toggle that switches the 14 letters to uppercase (guillemets unchanged), matching the official TCF software. (Behaviour.4, 5)
- [ ] Each character button is keyboard-operable (Enter/Space) with an accessible label, and inserted text remains within the `lang="fr"` textarea content. (Behaviour.6)
- [ ] Using the toolbar does not disrupt normal physical-keyboard typing into the same textarea. (Behaviour.7)

## Open questions
- ~~**Exact glyph set & layout.**~~ **Resolved 2026-06-17:** confirmed from a screenshot of the real
  TCF software — the 16-key 4×4 grid in §Behaviour.4 (`é è ê ë / à â ù û / ô î ï ç / œ æ « »`) with a
  `⇧ abc` shift toggle to uppercase.
- **Reuse surface.** The component is built reusable; whether to also surface it on any future French
  text input (beyond the Writing editor) is left open — no such input exists today.
- **Touch / mobile.** Tap insertion should work, but a dedicated mobile layout is not specified here;
  decide if needed (the app is local-first/desktop-oriented).
- **Placement.** Above vs. below the textarea (and sticky vs. inline) is a visual-design detail for
  implementation; default to a compact toolbar directly above each textarea.

## Revision history
- 2026-06-17: Initial draft (Milestone 12).
- 2026-06-17: Set the exact key set/layout to match a screenshot of the real TCF software — 16-key 4×4
  grid (`é è ê ë / à â ù û / ô î ï ç / œ æ « »`) + `⇧ abc` shift toggle; resolved the glyph-set open
  question.
- 2026-06-18: Status moved draft → approved (Milestone 12), alongside section-navigation. Wireframe
  added at docs/mockups.md §19.
