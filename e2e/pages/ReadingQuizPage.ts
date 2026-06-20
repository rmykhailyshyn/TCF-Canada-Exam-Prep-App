import { type Locator, type Page } from '@playwright/test';

// spec: docs/specs/reading-quiz-ui.md
// Page Object for the reading quiz screen: passage panel (image + OCR text), answer options, and
// the confirm/feedback/next controls.
export class ReadingQuizPage {
  readonly page: Page;
  readonly passageHeading: Locator;
  readonly passageImage: Locator;
  readonly confirmButton: Locator;
  readonly nextButton: Locator;
  readonly feedback: Locator;

  constructor(page: Page) {
    this.page = page;
    // spec: reading-quiz-ui §Layout.3–4 — passage panel above the options.
    this.passageHeading = page.getByRole('heading', { name: 'Passage' });
    // spec: reading-quiz-ui §Layout.3a — original passage image above the OCR text.
    this.passageImage = page.getByRole('img', { name: 'Original passage document' });
    this.confirmButton = page.getByRole('button', { name: 'Confirm answer' });
    this.nextButton = page.getByRole('button', { name: 'Next question' });
    this.feedback = page.getByText(/Correct!|Incorrect/);
  }

  // An answer option, addressed by its label letter. The accessible name is "<letter> <text>", so
  // anchoring on `^<letter> ` targets the option, not body text that may repeat the same words.
  option(label: 'A' | 'B' | 'C' | 'D'): Locator {
    return this.page.getByRole('button', { name: new RegExp(`^${label} `) });
  }

  async selectOption(label: 'A' | 'B' | 'C' | 'D'): Promise<void> {
    await this.option(label).click();
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async next(): Promise<void> {
    await this.nextButton.click();
  }

  // Decoded intrinsic width of the passage image — > 0 once the real PNG has loaded (vs the
  // text-only fallback). spec: reading-quiz-ui §Layout.3a.
  async passageImageNaturalWidth(): Promise<number> {
    return this.passageImage.evaluate((img: HTMLImageElement) => img.naturalWidth);
  }
}
