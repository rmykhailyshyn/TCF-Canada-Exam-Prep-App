import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { CompleteResult, SessionQuestion } from "../../lib/api";
import { SetupScreen } from "./SetupScreen";
import { QuestionPanel } from "./QuestionPanel";
import { ResultsScreen } from "./ResultsScreen";
import { QuizScreen } from "./QuizScreen";
import type { QuizSession } from "./useQuizSession";
import type { SessionConfig } from "./types";

// Render smoke tests: execute the component tree (catching runtime/import errors) and assert
// key spec behaviours that don't need a live browser. Visual/interaction checks would need a
// DOM driver; these guard against the highest-risk failure — a component throwing on render.

const question: SessionQuestion = {
  id: 1,
  sequence: 11,
  text: "Quel est le sujet du texte ?",
  passage: { id: 1, text: "Un passage de compréhension écrite." },
  options: [
    { label: "A", text: "Option A" },
    { label: "B", text: "Option B" },
    { label: "C", text: "Option C" },
    { label: "D", text: "Option D" },
  ],
};

function fakeSession(overrides: Partial<QuizSession> = {}): QuizSession {
  return {
    status: "active",
    error: null,
    sessionId: 1,
    mode: "real",
    question,
    index: 2,
    total: 9,
    selectedLabel: null,
    feedback: null,
    remainingMs: 2_832_000,
    results: null,
    elapsedMs: null,
    submitting: false,
    select: vi.fn(),
    confirm: vi.fn(),
    goNext: vi.fn(),
    submitExam: vi.fn(),
    ...overrides,
  };
}

describe("render smoke tests", () => {
  // spec: docs/specs/reading-quiz-ui.md §Session setup.1 + section-navigation §Behaviour.1,6
  it("renders the setup screen with all four sections and bands hidden until learning is picked", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SetupScreen onStart={vi.fn()} />
      </MemoryRouter>,
    );
    expect(html).toContain("Start a session");
    // All four sections are selectable from the landing picker (Milestone 12).
    expect(html).toContain("Reading");
    expect(html).toContain("Listening");
    expect(html).toContain("Writing");
    expect(html).toContain("Speaking");
    // Difficulty list only appears after choosing Learning (not on first render).
    expect(html).not.toContain("Upper-Intermediate");
  });

  // spec: docs/specs/reading-quiz-ui.md §Layout.5–6 — counter + real-mode timer
  it("renders the quiz screen header with counter and timer (real mode)", () => {
    const config: SessionConfig = { section: "reading", mode: "real" };
    const html = renderToStaticMarkup(
      <QuizScreen session={fakeSession()} config={config} />,
    );
    expect(html).toContain("Question 3 of 9");
    expect(html).toContain("⏱");
    expect(html).toContain("Submit exam");
    expect(html).toContain("Un passage de compréhension écrite.");
    // spec: reading-quiz-ui §Layout.3a — the passage image is rendered above the OCR text.
    expect(html).toContain("/api/questions/1/passage-image");
    expect(html).toContain("Original passage document");
  });

  // spec: docs/specs/reading-quiz-ui.md §Learning mode feedback.11–13
  it("renders the question panel feedback + explanation after a learning answer", () => {
    const html = renderToStaticMarkup(
      <QuestionPanel
        question={question}
        mode="learning"
        selectedLabel="A"
        feedback={{
          isCorrect: false,
          correctLabel: "B",
          explanation: {
            correctReason: "B est correct car…",
            optionAReason: "A est faux…",
            optionBReason: "B résume le texte…",
            optionCReason: "C hors sujet…",
            optionDReason: "D non mentionné…",
          },
        }}
        submitting={false}
        onSelect={vi.fn()}
        onConfirm={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(html).toContain("Incorrect");
    expect(html).toContain("B est correct car");
    expect(html).toContain("Next question");
  });

  // spec: docs/specs/quiz-session.md §Results.13 (real)
  it("renders real-mode results with points, correct count and time", () => {
    const results: CompleteResult = {
      correct: 28,
      total: 39,
      pointsScored: 387,
      pointsPossible: 699,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsScreen
          results={results}
          elapsedMs={2_592_000}
          config={{ section: "reading", mode: "real" }}
          sessionId={1}
          onHome={vi.fn()}
        />
      </MemoryRouter>,
    );
    // Presentation: points are the hero figure (387 / 699 + "points scored"); correct count and
    // time appear in the stats row beneath. All three spec-required values are present.
    expect(html).toContain("387");
    expect(html).toContain("699");
    expect(html).toContain("points scored");
    expect(html).toContain("28 / 39");
    expect(html).toContain("43:12");
  });

  // spec: docs/specs/quiz-session.md §Results.13 (learning) — correct/total + band, no points
  it("renders learning-mode results with band label and no points", () => {
    const results: CompleteResult = {
      correct: 7,
      total: 9,
      pointsScored: null,
      pointsPossible: null,
    };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ResultsScreen
          results={results}
          elapsedMs={null}
          config={{
            section: "reading",
            mode: "learning",
            difficulty: "intermediate",
          }}
          sessionId={1}
          onHome={vi.fn()}
        />
      </MemoryRouter>,
    );
    // Learning shows correct/total (hero + stats row) and the band; never a points figure.
    expect(html).toContain("7 / 9");
    expect(html).toContain("Intermediate (Q11–19, 15 pts)");
    expect(html).not.toContain("points");
  });
});
