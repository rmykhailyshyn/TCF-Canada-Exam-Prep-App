# Spec: Unified Section Navigation

## Status

implemented

> Milestone 12. A navigation/landing-UX change so all four exam sections (Reading, Listening, Writing,
> Speaking) are launchable from two consistent places: the landing screen and a persistent top menu.
> Presentation/routing only — no backend, data-model, or session-logic change. Assumes the four
> sections exist (Reading/Listening — M2/M3; Writing — M10; Speaking — M11).

## Goal

Today the landing screen's section picker only offers Reading and Listening; Writing (M10) and Speaking
(M11) were each wired in ad hoc as a single top-nav link. This unifies entry: **all four sections are
selectable from the landing (home) screen**, and **a persistent top menu offers quick navigation to
every section** (plus the existing History and Question Bank) from anywhere in the app. The user can
start any section in one click, and switch sections quickly without returning home first.

## Scope

- In scope:
  - Landing screen: a single section picker presenting all four sections (Reading, Listening, Writing,
    Speaking), each launching that section's setup/start.
  - A persistent top navigation menu (the app header) with quick links to all four sections plus
    History and Question Bank, available across screens.
  - Consistent routing from both places to each section's existing setup/start flow.
  - Indicating the active/current section in the top menu where applicable.
  - Graceful handling of a section whose content is not yet importable (shown, but indicating
    "no content yet" rather than erroring) — degrades cleanly if a section's data is absent.
- Out of scope:
  - Each section's setup details, session flow, scoring, and review (their own specs).
  - The on-screen virtual keyboard (the other Milestone 12 deliverable; see virtual-keyboard spec).
  - New routes or backend endpoints — this consumes the existing per-section routes.
  - Auth, role-based menus, or persisting a "last used section".

## Behaviour

1. The landing (home) screen presents **all four sections** — Reading, Listening, Writing, Speaking —
   as selectable entries (cards), each with a short label/description. Selecting one starts that
   section's setup/start flow.
2. A **persistent top navigation menu** (the app header) provides quick links to all four sections,
   plus **History** and **Question Bank**. It is shown on the landing screen and is reachable from the
   section screens, so the user can jump to another section without first going home.
3. Selecting a section from **either** place routes to that section's existing setup/start consistently
   (Reading/Listening → the quiz setup; Writing → the writing setup; Speaking → the speaking setup).
4. The top menu **indicates the current section** (active state) when the user is within a section.
5. If a selected section has **no imported content** yet, the UI shows a clear, friendly empty/“no
   content yet” state from that section's normal entry (the existing per-section error, e.g.
   `NO_TASKS` / no questions), rather than a crash or 404.
6. The four sections are presented in a **consistent order** everywhere (Reading, Listening, Writing,
   Speaking) and with consistent labels/icons, in both the landing picker and the top menu.

## Data model changes

None. Presentation/routing only.

## API contract

None. Consumes the existing per-section entry routes and the existing History / Question Bank routes.

## Acceptance criteria

Testable pass/fail conditions. Each maps back to the behaviours above.

- [x] The landing screen offers all four sections (Reading, Listening, Writing, Speaking) as selectable entries, each launching that section's setup/start. (Behaviour.1)
- [x] A persistent top menu exposes quick links to all four sections plus History and Question Bank, available on the landing screen and reachable from section screens. (Behaviour.2)
- [x] Selecting a section from either the landing picker or the top menu routes to that section's setup/start consistently. (Behaviour.3)
- [x] The top menu indicates the active section when the user is inside one. (Behaviour.4)
- [x] A section with no imported content shows a friendly empty state rather than erroring. (Behaviour.5)
- [x] Sections appear in a consistent order with consistent labels/icons in both the landing picker and the top menu. (Behaviour.6)

## Open questions

- ~~**Header on session screens.**~~ **Resolved 2026-06-18:** the in-session header (timer/progress)
  stays; the persistent top menu is landing/setup chrome only and is **not** shown mid-session (no
  quick section-switching during an active quiz/editor/recorder), to avoid abandoning a timed session.
- ~~**Reading vs. Listening share one setup.**~~ **Resolved 2026-06-18:** the landing picker keeps
  Reading/Listening inline in the shared `SetupScreen` (section + mode + difficulty); the
  Writing/Speaking cards route to their own setup screens (`/writing`, `/speaking`). The top menu
  pre-selects Reading/Listening via router state.

## Revision history

- 2026-06-18: Initial draft (Milestone 12).
- 2026-06-18: Status moved draft → approved (Milestone 12), alongside virtual-keyboard. Wireframe
  added at docs/mockups.md §20.
- 2026-06-18: Implemented. New `client/src/components/TopNav.tsx` is the persistent top menu (four
  sections + History + Question Bank, active-section highlight) on the landing and the Writing/Speaking
  setup, History and Question Bank screens; `SetupScreen` now shows all four section cards
  (Reading/Listening inline; Writing/Speaking route to their own setup, per the §Open-questions
  resolution). In-session headers are unchanged (no mid-session switching). Status approved →
  implemented.
