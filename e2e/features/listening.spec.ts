import { expect, test } from "../fixtures/test";
import { LISTENING_QUESTIONS } from "../fixtures/listening-data";

// spec: docs/specs/listening-quiz-ui.md + docs/specs/listening-player.md
// Drives the listening learning flow end-to-end against the seeded Beginner band (Q1–4): player
// loads, options unlock, subtitles render + click-to-seek, answer + feedback, advance, results.
//
// The seeded audio is generated tones and the transcripts are authored (see
// scripts/seed-listening-dev.ts) — these tests validate the player/quiz plumbing, not Whisper.
//
// spec: docs/specs/quiz-session.md §Question selection.21 — learning mode presents the band's
// questions in RANDOM order, so the tests identify whichever question is on screen by its unique
// correct option (ListeningQuizPage.currentQuestion) rather than assuming Q1 is first.

test.describe("Listening learning flow", () => {
  test.beforeEach(async ({ setupPage }) => {
    // Select the Listening section *card* by its French subtitle: section-navigation (M12) adds a
    // "Listening" top-menu link, so a bare /Listening/ would be ambiguous.
    await setupPage.startLearning(/Compréhension orale/, /Beginner/);
  });

  test("player, subtitles, answering, and results", async ({
    page,
    listeningQuiz,
    results,
  }) => {
    // spec: listening-quiz-ui §Layout — header shows section/mode and the band-sized counter.
    await expect(page.getByText("Listening · Learning")).toBeVisible();
    await expect(listeningQuiz.questionCounter(1, 4)).toBeVisible();

    // spec: listening-player §Behaviour.1,2,5 — options unlock once the clip can play, the loading
    // indicator clears, and the play control + current question's subtitles render.
    const first = await listeningQuiz.currentQuestion();
    await expect(listeningQuiz.option(first.correct)).toBeEnabled({
      timeout: 15_000,
    });
    await expect(listeningQuiz.loadingIndicator).toHaveCount(0);
    await expect(listeningQuiz.playButton).toBeVisible();
    await expect(listeningQuiz.subtitle(first.phrase2)).toBeVisible();

    // Answer all four with the correct option — in whatever (randomized) order they appear. Learning
    // mode reveals feedback each time; the counter still advances 1→4.
    for (let i = 0; i < LISTENING_QUESTIONS.length; i += 1) {
      await expect(listeningQuiz.questionCounter(i + 1, 4)).toBeVisible();
      const q = await listeningQuiz.currentQuestion();
      const correct = listeningQuiz.option(q.correct);
      await expect(correct).toBeEnabled({ timeout: 15_000 });
      await correct.click();
      await listeningQuiz.confirm();
      // spec: listening-quiz-ui §Learning mode feedback.11 — correct pick confirmed.
      await expect(page.getByText("Correct!")).toBeVisible();
      await listeningQuiz.next();
    }

    // spec: quiz-session §Results.13 — learning results show correct/total + band, no points.
    await expect(results.heading).toBeVisible();
    await expect(page.getByText("Listening · Learning")).toBeVisible();
    await expect(results.text(/Beginner/)).toBeVisible();
    // All four answered correctly → 4 / 4 (100%). The figure and its label render separately.
    await expect(results.text("4 / 4").first()).toBeVisible();
    await expect(results.correctAnswersLabel).toBeVisible();
  });

  test("subtitle click-to-seek moves audio position and the active highlight", async ({
    listeningQuiz,
  }) => {
    const q = await listeningQuiz.currentQuestion();
    await expect(listeningQuiz.option(q.correct)).toBeEnabled({
      timeout: 15_000,
    });

    // spec: listening-player §Behaviour.9–10 — clicking the 2nd phrase seeks to its start and
    // immediately makes it the active (highlighted) segment.
    const secondPhrase = listeningQuiz.subtitle(q.phrase2);
    await secondPhrase.click();

    await expect(secondPhrase).toHaveAttribute("aria-current", "true");
    const currentTime = await listeningQuiz.audioCurrentTime();
    expect(currentTime).toBeGreaterThanOrEqual(q.phrase2StartS - 0.1);
    expect(currentTime).toBeLessThan(q.phrase2StartS + 1.0);
  });

  test("a wrong answer is revealed against the correct option in learning mode", async ({
    page,
    listeningQuiz,
  }) => {
    // Pick a deliberately wrong option for whichever question is shown.
    const q = await listeningQuiz.currentQuestion();
    const wrong = listeningQuiz.option(q.wrong);
    await expect(wrong).toBeEnabled({ timeout: 15_000 });
    await wrong.click();
    await listeningQuiz.confirm();

    // spec: listening-quiz-ui §Learning mode feedback.11 — incorrect names the correct answer.
    await expect(page.getByText(/Incorrect/)).toBeVisible();
  });
});
