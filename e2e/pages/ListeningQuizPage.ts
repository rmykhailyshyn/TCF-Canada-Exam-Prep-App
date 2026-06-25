import { type Locator, type Page } from "@playwright/test";
import {
  type ListeningQuestion,
  LISTENING_QUESTIONS,
} from "../fixtures/listening-data";

// spec: docs/specs/listening-quiz-ui.md + docs/specs/listening-player.md
// Page Object for the listening quiz screen: audio player, subtitle segments, options, feedback.
export class ListeningQuizPage {
  readonly page: Page;
  readonly playButton: Locator;
  readonly loadingIndicator: Locator;
  readonly confirmButton: Locator;
  readonly nextButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.playButton = page.getByRole("button", { name: "Play" });
    this.loadingIndicator = page.getByText("Loading audio…");
    this.confirmButton = page.getByRole("button", { name: "Confirm answer" });
    this.nextButton = page.getByRole("button", { name: "Next question" });
  }

  // "Question N of M" counter in the header. spec: listening-quiz-ui §Layout.
  questionCounter(n: number, total: number): Locator {
    return this.page.getByText(`Question ${n} of ${total}`);
  }

  // An answer option by its text. The accessible name is "<letter> <text>"; anchoring on `^[A-D] `
  // targets the option, not a subtitle that may contain the same words.
  option(text: string): Locator {
    return this.page.getByRole("button", {
      name: new RegExp(`^[A-D] ${text}`),
    });
  }

  // A subtitle segment button, addressed by a phrase within it. spec: listening-player §Behaviour.9.
  subtitle(phrase: string): Locator {
    return this.page.getByRole("button", { name: new RegExp(phrase) });
  }

  // Identifies which seeded question is currently shown by its unique correct option. spec:
  // quiz-session §Question selection.21 — learning order is randomized.
  async currentQuestion(
    questions: ListeningQuestion[] = LISTENING_QUESTIONS,
  ): Promise<ListeningQuestion> {
    // Wait until the option list has rendered (it appears with the question, before audio unlocks).
    await this.page
      .getByRole("button", { name: /^[A-D] / })
      .first()
      .waitFor({ state: "attached", timeout: 15_000 });
    for (const q of questions) {
      if ((await this.option(q.correct).count()) > 0) return q;
    }
    throw new Error(
      "Could not identify the current listening question on screen.",
    );
  }

  async confirm(): Promise<void> {
    await this.confirmButton.click();
  }

  async next(): Promise<void> {
    await this.nextButton.click();
  }

  // Current playhead position of the page's <audio> element, in seconds. spec: listening-player
  // §Behaviour.9 — verifies click-to-seek moved the audio position.
  async audioCurrentTime(): Promise<number> {
    return this.page.evaluate(
      () => document.querySelector("audio")?.currentTime ?? 0,
    );
  }
}
