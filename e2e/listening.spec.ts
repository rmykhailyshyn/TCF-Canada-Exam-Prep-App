import { type Page, expect, test } from '@playwright/test';

// spec: docs/specs/listening-quiz-ui.md + docs/specs/listening-player.md
// Drives the listening learning flow end-to-end against the seeded Beginner band (Q1–4): player
// loads, options unlock, subtitles render + click-to-seek, answer + feedback, advance, results.
//
// The seeded audio is generated tones and the transcripts are authored (see
// scripts/seed-listening-dev.ts) — these tests validate the player/quiz plumbing, not Whisper.

// Correct option text for each seeded Beginner question, in order.
const CORRECT = ['À la gare', 'Vendredi', 'Un thé', 'Il fera beau'];

async function startListeningLearning(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Listening/ }).click();
  await page.getByRole('button', { name: /Learning/ }).click();
  await page.getByRole('button', { name: /Beginner/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
}

test('listening learning flow: player, subtitles, answering, and results', async ({ page }) => {
  await startListeningLearning(page);

  // spec: listening-quiz-ui §Layout — header shows section/mode and the band-sized counter.
  await expect(page.getByText('Listening · Learning')).toBeVisible();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();

  // spec: listening-player §Behaviour.1 — options unlock once the clip can play. The correct
  // option button becomes enabled when audio is ready.
  const firstCorrect = page.getByRole('button', { name: new RegExp(CORRECT[0]) });
  await expect(firstCorrect).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('Loading audio…')).toHaveCount(0);

  // spec: listening-player §Behaviour.2,5 — play control + subtitle list are present.
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bonjour, je suis à la gare/ })).toBeVisible();

  // Answer all four with the correct option; learning mode reveals feedback each time.
  for (let i = 0; i < CORRECT.length; i += 1) {
    await expect(page.getByText(`Question ${i + 1} of 4`)).toBeVisible();
    const correct = page.getByRole('button', { name: new RegExp(CORRECT[i]) });
    await expect(correct).toBeEnabled({ timeout: 15_000 });
    await correct.click();
    await page.getByRole('button', { name: 'Confirm answer' }).click();
    // spec: listening-quiz-ui §Learning mode feedback.11 — correct pick confirmed.
    await expect(page.getByText('Correct!')).toBeVisible();
    await page.getByRole('button', { name: 'Next question' }).click();
  }

  // spec: quiz-session §Results.13 — learning results show correct/total + band, no points.
  await expect(page.getByText('Session complete')).toBeVisible();
  await expect(page.getByText('Listening · Learning')).toBeVisible();
  await expect(page.getByText(/Beginner/)).toBeVisible();
  await expect(page.getByText('4 / 4 correct')).toBeVisible();
});

test('subtitle click-to-seek moves audio position and the active highlight', async ({ page }) => {
  await startListeningLearning(page);

  const firstCorrect = page.getByRole('button', { name: new RegExp(CORRECT[0]) });
  await expect(firstCorrect).toBeEnabled({ timeout: 15_000 });

  // spec: listening-player §Behaviour.9–10 — clicking the 2nd phrase (starts at 2.0s) seeks there
  // and immediately makes it the active (highlighted) segment.
  const secondPhrase = page.getByRole('button', { name: /Mon train part dans dix minutes/ });
  await secondPhrase.click();

  await expect(secondPhrase).toHaveAttribute('aria-current', 'true');
  const currentTime = await page.evaluate(
    () => document.querySelector('audio')?.currentTime ?? 0,
  );
  expect(currentTime).toBeGreaterThanOrEqual(1.9);
  expect(currentTime).toBeLessThan(3.0);
});

test('a wrong answer is revealed against the correct option in learning mode', async ({ page }) => {
  await startListeningLearning(page);

  // Q1 correct is "À la gare"; pick a wrong option deliberately.
  const wrong = page.getByRole('button', { name: /Au restaurant/ });
  await expect(wrong).toBeEnabled({ timeout: 15_000 });
  await wrong.click();
  await page.getByRole('button', { name: 'Confirm answer' }).click();

  // spec: listening-quiz-ui §Learning mode feedback.11 — incorrect names the correct answer (A).
  await expect(page.getByText(/Incorrect/)).toBeVisible();
});
