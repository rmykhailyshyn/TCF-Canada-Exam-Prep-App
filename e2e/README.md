# E2E Test Conventions

Playwright end-to-end suite for the quiz UI. Run with `npm run test:e2e`. These conventions follow
the `e2e-testing` skill (Page Object Model + fixtures + structured layout); **all new e2e tests must
follow them.** Where this project deliberately diverges from the skill, it's called out below.

## Layout

```
e2e/
├── api/                 # API-contract specs (request-context, no UI)
│   └── api.spec.ts
├── features/            # UI flow specs, one file per feature
│   ├── reading.spec.ts
│   ├── listening.spec.ts
│   └── setup.spec.ts
├── pages/               # Page Objects — one class per screen
│   ├── SetupPage.ts
│   ├── ReadingQuizPage.ts
│   ├── ListeningQuizPage.ts
│   └── ResultsPage.ts
├── fixtures/            # Shared fixtures + test data
│   ├── test.ts          # extends base test with page-object + api fixtures (import from here)
│   ├── api-client.ts    # ApiClient — session lifecycle + envelope unwrapping
│   └── listening-data.ts# seeded listening question data
├── global-setup.ts      # creates/migrates/seeds the dedicated tcf_prep_e2e DB (referenced by config)
└── README.md
```

`playwright.config.ts` (repo root) sets `testDir: './e2e'`; specs are globbed recursively, so the
`api/` and `features/` subfolders are organisational only. `global-setup.ts`, `pages/`, and
`fixtures/` are never collected as tests (they aren't `*.spec.ts`).

## Rules for new tests

1. **Import from the fixture, not Playwright directly.**
   `import { expect, test } from '../fixtures/test';` — this injects the Page Objects (`setupPage`,
   `readingQuiz`, `listeningQuiz`, `results`) and the `api` client. Never
   `import { test } from '@playwright/test'` in a spec.

2. **One Page Object per screen, in `pages/`.** Expose locators as readonly fields set in the
   constructor and actions as methods. A new screen → add its Page Object class, then wire it as a
   fixture in `fixtures/test.ts` so every spec gets it. Keep selectors inside the Page Object; specs
   should not contain raw `page.locator(...)` for elements a Page Object owns.

3. **Accessible-role locators only** (`getByRole`, `getByText`, `getByLabel`). This is a deliberate
   divergence from the skill's `data-testid` selectors: the app ships no test ids, and role-based
   locators double as accessibility assertions and are Playwright's recommended default. Add a
   `data-testid` only if a target is genuinely unreachable by role/text, and prefer fixing the
   markup's semantics first.

4. **No arbitrary waits.** Never `waitForTimeout`. Rely on auto-waiting locators and web-first
   assertions (`await expect(locator).toBeVisible()`), `expect.poll(...)` for derived values
   (e.g. `img.naturalWidth`), and `waitForResponse`/`waitFor({ state })` for explicit conditions.

5. **`test.describe` + `test.beforeEach`** for shared arrange steps (navigation, session start).
   Keep each `test` to a single behaviour with a clear name.

6. **Keep the spec traceability comment** (`// spec: docs/specs/<file>.md §Behaviour.N`) on the spec
   and on non-trivial Page Object methods — this is CLAUDE.md Rule 5, not optional.

7. **API setup via `ApiClient`.** Use the `api` fixture for session creation / answers / completion
   and envelope unwrapping. Keep raw status/header/byte assertions inline in the spec that targets
   that endpoint (that *is* the thing under test).

## Determinism & isolation

The suite runs serially (`workers: 1`, `fullyParallel: false`) because flows mutate shared session
state through one set of dev servers. `global-setup.ts` provisions a dedicated `tcf_prep_e2e`
database (migrate + reading/listening seeds, generating listening MP3s via ffmpeg) and the webServer
runs the app against that same DB, so runs never touch the dev DB. Stop any local `npm run dev`
before invoking the suite (the config never reuses an existing server).

Tests stay tolerant of dev-DB question counts where totals aren't seed-guaranteed (assert behaviour,
not exact numbers) — except real-mode reading, where the seed fills all 39 positions.
