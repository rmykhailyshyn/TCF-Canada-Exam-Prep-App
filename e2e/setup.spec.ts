import { expect, test } from '@playwright/test';

// spec: docs/specs/listening-quiz-ui.md §Session setup (Behaviour.1–2) + reading-quiz-ui.md §1–2
// The setup screen now offers both sections; difficulty appears only in learning mode and gates Start.

test.describe('setup screen', () => {
  test('offers Listening as a selectable section (no longer "coming soon")', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Start a session' })).toBeVisible();
    const listening = page.getByRole('button', { name: /Listening/ });
    await expect(listening).toBeVisible();
    await expect(listening).toBeEnabled();
    await expect(page.getByText('Coming soon')).toHaveCount(0);
  });

  test('reveals difficulty bands only after Learning is chosen, and Start gates on selection', async ({
    page,
  }) => {
    await page.goto('/');
    // Difficulty hidden initially.
    await expect(page.getByRole('button', { name: /Upper-Intermediate/ })).toHaveCount(0);
    // Start disabled with no mode chosen.
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: /Learning/ }).click();
    // Bands now visible; Start still disabled until a band is picked.
    await expect(page.getByRole('button', { name: /Upper-Intermediate/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: /Beginner/ }).click();
    await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  });

  test('real-mode subtitle reflects the listening time limit (35 min)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Listening/ }).click();
    await page.getByRole('button', { name: /Real/ }).click();
    await expect(page.getByText('35 min · 39 questions · no feedback')).toBeVisible();
  });
});
