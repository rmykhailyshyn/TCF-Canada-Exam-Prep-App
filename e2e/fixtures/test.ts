import { test as base } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiClient } from "./api-client";
import { SetupPage } from "../pages/SetupPage";
import { ReadingQuizPage } from "../pages/ReadingQuizPage";
import { ListeningQuizPage } from "../pages/ListeningQuizPage";
import { ResultsPage } from "../pages/ResultsPage";

// Central test fixture. All e2e specs import { test, expect } from here (not '@playwright/test'),
// so every test receives the Page Objects and the API client pre-wired to the current page/request.
// Adding a new screen → add its Page Object and a fixture here; new specs get it for free.
type Fixtures = {
  setupPage: SetupPage;
  readingQuiz: ReadingQuizPage;
  listeningQuiz: ListeningQuizPage;
  results: ResultsPage;
  api: ApiClient;
  // Auto fixture: collects istanbul client coverage when COVERAGE=1 (inert otherwise).
  collectClientCoverage: void;
};

// spec: docs/specs/test-coverage.md §Behaviour.2 (client coverage collected from window.__coverage__
// after each test), §Behaviour.8 (guarded by COVERAGE=1 so plain `npm run test:e2e` is unaffected).
// Client counter for unique per-test artifact filenames (avoids clobbering across the serial suite).
let clientCoverageCounter = 0;
const CLIENT_COVERAGE_DIR = resolve(process.cwd(), "coverage/e2e-client");

export const test = base.extend<Fixtures>({
  collectClientCoverage: [
    async ({ page }, use, testInfo): Promise<void> => {
      await use();
      if (process.env.COVERAGE !== "1") return;
      // Read the istanbul-instrumented counters off the page BEFORE Playwright tears the page down
      // (this fixture depends on `page`, so `page` is still alive during this teardown).
      const coverage = await page
        .evaluate(
          () =>
            (window as unknown as { __coverage__?: unknown }).__coverage__ ??
            null,
        )
        .catch(() => null);
      if (!coverage) return;
      mkdirSync(CLIENT_COVERAGE_DIR, { recursive: true });
      clientCoverageCounter += 1;
      const slug = testInfo.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
      writeFileSync(
        resolve(
          CLIENT_COVERAGE_DIR,
          `client-${String(clientCoverageCounter).padStart(4, "0")}-${slug}-${Date.now()}.json`,
        ),
        JSON.stringify(coverage),
      );
    },
    { auto: true },
  ],
  setupPage: async ({ page }, use) => {
    await use(new SetupPage(page));
  },
  readingQuiz: async ({ page }, use) => {
    await use(new ReadingQuizPage(page));
  },
  listeningQuiz: async ({ page }, use) => {
    await use(new ListeningQuizPage(page));
  },
  results: async ({ page }, use) => {
    await use(new ResultsPage(page));
  },
  api: async ({ request }, use) => {
    await use(new ApiClient(request));
  },
});

export { expect } from "@playwright/test";
