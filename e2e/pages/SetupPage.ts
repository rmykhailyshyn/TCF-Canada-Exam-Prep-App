import { type Locator, type Page, expect } from '@playwright/test';

// spec: docs/specs/listening-quiz-ui.md §Session setup (Behaviour.1–2) + reading-quiz-ui.md §1–2
// Page Object for the "Start a session" landing screen: section / mode / difficulty selection and
// the gated Start button. Locators are accessible-role based (see e2e/README.md), so the object
// stays valid as long as the screen's roles/labels are stable.
export class SetupPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly startButton: Locator;
  readonly comingSoonBadge: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Start a session' });
    this.startButton = page.getByRole('button', { name: 'Start session', exact: true });
    this.comingSoonBadge = page.getByText('Coming soon');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.heading).toBeVisible();
  }

  // A selectable chip/button on the setup screen, addressed by its visible label. Used for sections
  // ("Reading"), modes ("Learning"/"Real") and difficulty bands ("Beginner") alike — they are all
  // buttons distinguished by name.
  button(name: string | RegExp): Locator {
    return this.page.getByRole('button', { name: typeof name === 'string' ? new RegExp(name) : name });
  }

  async chooseSection(name: string | RegExp): Promise<void> {
    await this.button(name).click();
  }

  async chooseMode(mode: 'Learning' | 'Real'): Promise<void> {
    await this.button(mode).click();
  }

  async chooseBand(band: string | RegExp): Promise<void> {
    await this.button(band).click();
  }

  async start(): Promise<void> {
    await this.startButton.click();
  }

  // Convenience: full learning-mode launch from a cold load (section → Learning → band → Start).
  async startLearning(section: string | RegExp, band: string | RegExp): Promise<void> {
    await this.goto();
    await this.chooseSection(section);
    await this.chooseMode('Learning');
    await this.chooseBand(band);
    await this.start();
  }

  // Convenience: full real-mode launch from a cold load (real mode has no difficulty band).
  async startReal(section: string | RegExp): Promise<void> {
    await this.goto();
    await this.chooseSection(section);
    await this.chooseMode('Real');
    await this.start();
  }
}
