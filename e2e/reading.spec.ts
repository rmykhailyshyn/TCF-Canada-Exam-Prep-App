import { expect, test } from '@playwright/test';

// spec: docs/specs/reading-quiz-ui.md
// Reading learning smoke: a passage + four options render and a confirmed answer reveals feedback.
// Kept tolerant of the dev DB's question count (it asserts behaviour, not exact totals).

test('reading learning flow renders a passage and reveals feedback on confirm', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Reading/ }).click();
  await page.getByRole('button', { name: /Learning/ }).click();
  await page.getByRole('button', { name: /Beginner/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // spec: reading-quiz-ui §Layout.3–4 — passage panel + options below it.
  await expect(page.getByRole('heading', { name: 'Passage' })).toBeVisible();
  await expect(page.getByText('Listening · Learning')).toHaveCount(0);
  await expect(page.getByText(/Reading · Learning/)).toBeVisible();

  // Select option A and confirm; learning mode reveals correct/incorrect feedback.
  await page.getByRole('button', { name: /^A / }).click();
  await page.getByRole('button', { name: 'Confirm answer' }).click();
  await expect(page.getByText(/Correct!|Incorrect/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
});
