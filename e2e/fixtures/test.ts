import { test as base } from '@playwright/test';
import { ApiClient } from './api-client';
import { SetupPage } from '../pages/SetupPage';
import { ReadingQuizPage } from '../pages/ReadingQuizPage';
import { ListeningQuizPage } from '../pages/ListeningQuizPage';
import { ResultsPage } from '../pages/ResultsPage';

// Central test fixture. All e2e specs import { test, expect } from here (not '@playwright/test'),
// so every test receives the Page Objects and the API client pre-wired to the current page/request.
// Adding a new screen → add its Page Object and a fixture here; new specs get it for free.
type Fixtures = {
  setupPage: SetupPage;
  readingQuiz: ReadingQuizPage;
  listeningQuiz: ListeningQuizPage;
  results: ResultsPage;
  api: ApiClient;
};

export const test = base.extend<Fixtures>({
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

export { expect } from '@playwright/test';
