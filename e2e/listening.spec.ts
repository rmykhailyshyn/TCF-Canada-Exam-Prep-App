import { type Page, expect, test } from '@playwright/test';

// spec: docs/specs/listening-quiz-ui.md + docs/specs/listening-player.md
// Drives the listening learning flow end-to-end against the seeded Beginner band (Q1–4): player
// loads, options unlock, subtitles render + click-to-seek, answer + feedback, advance, results.
//
// The seeded audio is generated tones and the transcripts are authored (see
// scripts/seed-listening-dev.ts) — these tests validate the player/quiz plumbing, not Whisper.
//
// spec: docs/specs/quiz-session.md §Question selection.21 — learning mode now presents the band's
// questions in RANDOM order, so these tests must not assume Q1 is shown first. Each seeded question
// has a unique correct option, so we identify whichever question is on screen and act on it.

type Q = { correct: string; wrong: string; phrase2: string; phrase2StartS: number };

// Mirrors scripts/seed-listening-dev.ts (Beginner band). `correct`/`wrong` are option texts;
// `phrase2` is a unique substring of the 2nd transcript segment and `phrase2StartS` its start.
const QUESTIONS: Q[] = [
  { correct: 'À la gare', wrong: 'Au restaurant', phrase2: 'Mon train part dans dix minutes', phrase2StartS: 2.0 },
  { correct: 'Vendredi', wrong: 'Lundi', phrase2: 'Nous nous voyons vendredi matin', phrase2StartS: 2.0 },
  { correct: 'Un thé', wrong: 'Un café', phrase2: 'Je voudrais un thé', phrase2StartS: 1.8 },
  { correct: 'Il fera beau', wrong: 'Il pleuvra', phrase2: 'Le ciel sera dégagé toute la journée', phrase2StartS: 2.0 },
];

// The option button's accessible name is the label letter + space + text (e.g. "A À la gare").
// Anchoring on `^[A-D] ` targets the option, not a subtitle that may contain the same words.
function optionByText(page: Page, text: string) {
  return page.getByRole('button', { name: new RegExp(`^[A-D] ${text}`) });
}

async function startListeningLearning(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Listening/ }).click();
  await page.getByRole('button', { name: /Learning/ }).click();
  await page.getByRole('button', { name: /Beginner/ }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
}

// Identifies which seeded question is currently shown by its unique correct option.
async function currentQuestion(page: Page): Promise<Q> {
  // Wait until the option list has rendered (it appears with the question, before audio unlocks).
  await page.getByRole('button', { name: /^[A-D] / }).first().waitFor({ state: 'attached', timeout: 15_000 });
  for (const q of QUESTIONS) {
    if ((await optionByText(page, q.correct).count()) > 0) return q;
  }
  throw new Error('Could not identify the current listening question on screen.');
}

test('listening learning flow: player, subtitles, answering, and results', async ({ page }) => {
  await startListeningLearning(page);

  // spec: listening-quiz-ui §Layout — header shows section/mode and the band-sized counter.
  await expect(page.getByText('Listening · Learning')).toBeVisible();
  await expect(page.getByText('Question 1 of 4')).toBeVisible();

  // spec: listening-player §Behaviour.1,2,5 — options unlock once the clip can play, the loading
  // indicator clears, and the play control + current question's subtitles render.
  const first = await currentQuestion(page);
  await expect(optionByText(page, first.correct)).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByText('Loading audio…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(first.phrase2) })).toBeVisible();

  // Answer all four with the correct option — in whatever (randomized) order they appear. Learning
  // mode reveals feedback each time; the counter still advances 1→4.
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    await expect(page.getByText(`Question ${i + 1} of 4`)).toBeVisible();
    const q = await currentQuestion(page);
    const correct = optionByText(page, q.correct);
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
  // All four answered correctly → 4 / 4 (100%). The figure and its label render separately.
  await expect(page.getByText('4 / 4').first()).toBeVisible();
  await expect(page.getByText('correct answers')).toBeVisible();
});

test('subtitle click-to-seek moves audio position and the active highlight', async ({ page }) => {
  await startListeningLearning(page);

  const q = await currentQuestion(page);
  await expect(optionByText(page, q.correct)).toBeEnabled({ timeout: 15_000 });

  // spec: listening-player §Behaviour.9–10 — clicking the 2nd phrase seeks to its start and
  // immediately makes it the active (highlighted) segment.
  const secondPhrase = page.getByRole('button', { name: new RegExp(q.phrase2) });
  await secondPhrase.click();

  await expect(secondPhrase).toHaveAttribute('aria-current', 'true');
  const currentTime = await page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0);
  expect(currentTime).toBeGreaterThanOrEqual(q.phrase2StartS - 0.1);
  expect(currentTime).toBeLessThan(q.phrase2StartS + 1.0);
});

test('a wrong answer is revealed against the correct option in learning mode', async ({ page }) => {
  await startListeningLearning(page);

  // Pick a deliberately wrong option for whichever question is shown.
  const q = await currentQuestion(page);
  const wrong = optionByText(page, q.wrong);
  await expect(wrong).toBeEnabled({ timeout: 15_000 });
  await wrong.click();
  await page.getByRole('button', { name: 'Confirm answer' }).click();

  // spec: listening-quiz-ui §Learning mode feedback.11 — incorrect names the correct answer.
  await expect(page.getByText(/Incorrect/)).toBeVisible();
});
