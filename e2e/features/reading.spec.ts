import { expect, test } from '../fixtures/test';

// spec: docs/specs/reading-quiz-ui.md
// Reading learning smoke: a passage + four options render and a confirmed answer reveals feedback.
// Tolerant of the dev DB's question count — it asserts behaviour, not exact totals.

test.describe('Reading learning flow', () => {
  test.beforeEach(async ({ setupPage }) => {
    // Select the Reading section *card* by its French subtitle: section-navigation (M12) adds a
    // "Reading" top-menu link, so a bare /Reading/ would be ambiguous.
    await setupPage.startLearning(/Compréhension écrite/, /Beginner/);
  });

  test('renders a passage and reveals feedback on confirm', async ({ page, readingQuiz }) => {
    // spec: reading-quiz-ui §Layout.3–4 — passage panel + options below it.
    await expect(readingQuiz.passageHeading).toBeVisible();
    await expect(page.getByText('Listening · Learning')).toHaveCount(0);
    await expect(page.getByText(/Reading · Learning/)).toBeVisible();

    // spec: reading-quiz-ui §Layout.3a — the original passage image renders above the OCR text. The
    // dev seed writes real placeholder PNGs, so the image loads (naturalWidth > 0) rather than
    // falling back to text-only.
    await expect(readingQuiz.passageImage).toBeVisible();
    await expect.poll(() => readingQuiz.passageImageNaturalWidth()).toBeGreaterThan(0);

    // Select option A and confirm; learning mode reveals correct/incorrect feedback.
    await readingQuiz.selectOption('A');
    await readingQuiz.confirm();
    await expect(readingQuiz.feedback).toBeVisible();
    await expect(readingQuiz.nextButton).toBeVisible();
  });
});
