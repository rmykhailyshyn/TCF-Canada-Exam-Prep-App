import { type Locator, type Page } from '@playwright/test';

// spec: docs/specs/quiz-session.md §Results
// Page Object for the end-of-session results screen.
export class ResultsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly correctAnswersLabel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByText('Session complete');
    this.correctAnswersLabel = page.getByText('correct answers');
  }

  // A free-text result figure, e.g. the score "4 / 4" or a band label. The figure and its label
  // render separately, so callers typically use `.first()` on the returned locator.
  text(value: string | RegExp): Locator {
    return this.page.getByText(value);
  }
}
