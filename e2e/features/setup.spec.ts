import { expect, test } from "../fixtures/test";

// spec: docs/specs/listening-quiz-ui.md §Session setup (Behaviour.1–2) + reading-quiz-ui.md §1–2 +
// section-navigation.md §Behaviour.1. The setup screen offers all four sections; difficulty appears
// only in learning mode and gates Start.
//
// Note: the persistent top menu (section-navigation, M12) also exposes "Reading"/"Listening" links,
// so section *cards* are selected by their French subtitle (unique to the card) to stay unambiguous.

test.describe("Setup screen", () => {
  test.beforeEach(async ({ setupPage }) => {
    await setupPage.goto();
  });

  test('offers Listening as a selectable section (no longer "coming soon")', async ({
    setupPage,
  }) => {
    const listening = setupPage.button(/Compréhension orale/);
    await expect(listening).toBeVisible();
    await expect(listening).toBeEnabled();
    await expect(setupPage.comingSoonBadge).toHaveCount(0);
  });

  test("reveals difficulty bands only after Learning is chosen, and Start gates on selection", async ({
    setupPage,
  }) => {
    // Difficulty hidden initially.
    await expect(setupPage.button(/Upper-Intermediate/)).toHaveCount(0);
    // Start disabled with no mode chosen.
    await expect(setupPage.startButton).toBeDisabled();

    await setupPage.chooseMode("Learning");
    // Bands now visible; Start still disabled until a band is picked.
    await expect(setupPage.button(/Upper-Intermediate/)).toBeVisible();
    await expect(setupPage.startButton).toBeDisabled();

    await setupPage.chooseBand(/Beginner/);
    await expect(setupPage.startButton).toBeEnabled();
  });

  test("real-mode subtitle reflects the listening time limit (35 min)", async ({
    page,
    setupPage,
  }) => {
    await setupPage.chooseSection(/Compréhension orale/);
    await setupPage.chooseMode("Real");
    await expect(
      page.getByText("35 min · 39 questions · no feedback"),
    ).toBeVisible();
  });
});
