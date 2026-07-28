// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "../lib/api";
import { CapabilitiesContext } from "../lib/capabilities-context";
import { apiError, stubFetch } from "../test-support/fetch";
import { HistoryPage } from "./HistoryPage";
import { ReviewPage } from "./ReviewPage";
import { SessionDetailPage } from "./SessionDetailPage";

// spec: docs/specs/progress-tracking.md §Behaviour.4–8; docs/specs/review-mode.md §Behaviour.3–6;
// docs/specs/content-deploy.md §Behaviour.7 (online sessions list as unscored)
//
// The history/review route components in a real DOM, over a stubbed `fetch` — the loading, error and
// empty states plus the label rules that decide what a candidate actually reads on the screen.

const LOCAL: Capabilities = {
  aiScoring: true,
  transcription: true,
  imports: true,
};

function renderAt(path: string, route: string, element: JSX.Element) {
  return render(
    <CapabilitiesContext.Provider value={LOCAL}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </CapabilitiesContext.Provider>,
  );
}

const READING_REAL = {
  id: 1,
  section: "reading",
  mode: "real",
  difficulty: null,
  completedAt: "2026-07-01T10:00:00.000Z",
  correct: 8,
  total: 10,
  pointsScored: 120,
  pointsPossible: 150,
  overallScore: null,
  tasksSubmitted: null,
  elapsedMs: 600_000,
};

const READING_LEARNING = {
  ...READING_REAL,
  id: 2,
  mode: "learning",
  difficulty: "beginner",
  pointsScored: null,
  pointsPossible: null,
  elapsedMs: null,
};

const WRITING_SCORED = {
  ...READING_REAL,
  id: 3,
  section: "writing",
  mode: "learning",
  correct: 0,
  total: 0,
  pointsScored: null,
  pointsPossible: null,
  overallScore: 15,
  tasksSubmitted: 3,
};

const SPEAKING_UNSCORED = {
  ...WRITING_SCORED,
  id: 4,
  section: "speaking",
  overallScore: null,
  tasksSubmitted: 0,
  elapsedMs: null,
};

afterEach(() => {
  // Auto-cleanup is off without vitest `globals`, so unmount explicitly between tests.
  cleanup();
  vi.unstubAllGlobals();
});

describe("HistoryPage", () => {
  it("shows a loading state, then the empty state when nothing is completed", async () => {
    stubFetch({ "GET /api/sessions": () => ({ sessions: [] }) });
    renderAt("/history", "/history", <HistoryPage />);
    expect(screen.getByText("Loading…")).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText("No completed sessions yet.")).toBeDefined();
    });
  });

  it("shows the API error instead of a list", async () => {
    stubFetch({
      "GET /api/sessions": apiError("INTERNAL", "Database unavailable."),
    });
    renderAt("/history", "/history", <HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText("Database unavailable.")).toBeDefined();
    });
  });

  // spec: §Behaviour.6 — a real session shows weighted points, correct/total and the clock.
  it("labels a real reading session with points, score and elapsed time", async () => {
    stubFetch({ "GET /api/sessions": () => ({ sessions: [READING_REAL] }) });
    renderAt("/history", "/history", <HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/120 \/ 150 pts/)).toBeDefined();
    });
    expect(screen.getByText(/8 \/ 10 correct/)).toBeDefined();
    expect(screen.getByText(/10:00/)).toBeDefined();
  });

  // A learning session shows its band instead of weighted points.
  it("labels a learning session with its difficulty band and no points", async () => {
    stubFetch({
      "GET /api/sessions": () => ({ sessions: [READING_LEARNING] }),
    });
    renderAt("/history", "/history", <HistoryPage />);
    const row = await screen.findByText(/8 \/ 10 correct/);
    expect(row.textContent).toMatch(/Beginner/);
    // No weighted-points prefix (the band label's own "3 pts" is part of its name).
    expect(row.textContent).not.toMatch(/120 \/ 150 pts/);
  });

  // spec: §Writing & speaking sessions — an overall /20 average and a task count, not correct/total.
  it("labels a writing session with its average and task count", async () => {
    stubFetch({ "GET /api/sessions": () => ({ sessions: [WRITING_SCORED] }) });
    renderAt("/history", "/history", <HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/15 \/ 20 avg/)).toBeDefined();
    });
    expect(screen.getByText(/3 tasks/)).toBeDefined();
    // "learning" is presented as "Training" for writing/speaking.
    expect(screen.getByText(/Training/)).toBeDefined();
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — never a fabricated "0 / 20".
  it('shows "not scored" for an unscored online session', async () => {
    stubFetch({
      "GET /api/sessions": () => ({ sessions: [SPEAKING_UNSCORED] }),
    });
    renderAt("/history", "/history", <HistoryPage />);
    await waitFor(() => {
      expect(screen.getByText(/not scored/)).toBeDefined();
    });
    expect(screen.queryByText(/0 \/ 20/)).toBeNull();
  });

  it("lists every completed session", async () => {
    stubFetch({
      "GET /api/sessions": () => ({
        sessions: [READING_REAL, READING_LEARNING, WRITING_SCORED],
      }),
    });
    renderAt("/history", "/history", <HistoryPage />);
    await waitFor(() => {
      expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(3);
    });
  });
});

const DETAIL = {
  session: READING_LEARNING,
  results: [
    {
      id: 1,
      questionId: 11,
      sequence: 1,
      text: "Quel est le sujet ?",
      passage: { text: "Le texte source." },
      options: [
        { label: "A", text: "Option A" },
        { label: "B", text: "Option B" },
        { label: "C", text: "Option C" },
        { label: "D", text: "Option D" },
      ],
      chosenLabel: "B",
      correctLabel: "A",
      isCorrect: false,
      difficulty: "beginner",
      explanation: {
        correctReason: "The passage says so.",
        optionAReason: "A reason",
        optionBReason: "B reason",
        optionCReason: "C reason",
        optionDReason: "D reason",
      },
      answeredAt: "2026-07-01T10:00:00.000Z",
    },
    {
      id: 2,
      questionId: 12,
      sequence: 2,
      text: "Deuxième question ?",
      passage: null,
      options: [
        { label: "A", text: "Option A" },
        { label: "B", text: "Option B" },
        { label: "C", text: "Option C" },
        { label: "D", text: "Option D" },
      ],
      chosenLabel: "C",
      correctLabel: "C",
      isCorrect: true,
      difficulty: "beginner",
      explanation: null,
      answeredAt: "2026-07-01T10:01:00.000Z",
    },
  ],
};

describe("SessionDetailPage", () => {
  it("shows the API error when the session cannot be loaded", async () => {
    stubFetch({
      "GET /api/sessions/2": apiError("SESSION_NOT_FOUND", "Session not found."),
    });
    renderAt("/history/2", "/history/:id", <SessionDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Session not found.")).toBeDefined();
    });
  });

  // spec: docs/specs/progress-tracking.md §Behaviour.7 — the summary card, not the question list.
  it("summarises a completed learning session with its band", async () => {
    stubFetch({ "GET /api/sessions/2": () => DETAIL });
    renderAt("/history/2", "/history/:id", <SessionDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Session complete")).toBeDefined();
    });
    expect(screen.getByText(/Beginner/)).toBeDefined();
    // Learning mode awards no weighted points.
    expect(screen.queryByText(/points/)).toBeNull();
  });

  it("shows the weighted points of a completed real session", async () => {
    stubFetch({
      "GET /api/sessions/1": () => ({ ...DETAIL, session: READING_REAL }),
    });
    renderAt("/history/1", "/history/:id", <SessionDetailPage />);
    await waitFor(() => {
      expect(screen.getByText(/120 \/ 150 points/)).toBeDefined();
    });
  });
});

describe("ReviewPage", () => {
  it("shows the API error when the session cannot be loaded", async () => {
    stubFetch({
      "GET /api/sessions/2": apiError("SESSION_NOT_FOUND", "Session not found."),
    });
    renderAt("/review/2", "/review/:id", <ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Session not found.")).toBeDefined();
    });
  });

  // spec: docs/specs/review-mode.md §Behaviour.3–4 — every answered question, in sequence order.
  it("lists the answered questions with the chosen and correct options", async () => {
    stubFetch({ "GET /api/sessions/2": () => DETAIL });
    renderAt("/review/2", "/review/:id", <ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText(/Quel est le sujet/)).toBeDefined();
    });
    expect(screen.getByText(/Deuxième question/)).toBeDefined();
  });

  // spec: §Behaviour.4 — the correct option is marked and the wrong choice flagged.
  it("marks each question correct or incorrect", async () => {
    stubFetch({ "GET /api/sessions/2": () => DETAIL });
    renderAt("/review/2", "/review/:id", <ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Incorrect")).toBeDefined();
    });
    expect(screen.getByText("Correct")).toBeDefined();
    // Read-only review: every option is disabled (Behaviour.2).
    for (const option of screen.getAllByRole("button", { name: /Option / })) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
  });

  // spec: §Behaviour.6 / llm-enrichment §Behaviour.10 — explanations show for learning AND real.
  it("surfaces the stored explanation with a per-option reason", async () => {
    stubFetch({ "GET /api/sessions/2": () => DETAIL });
    renderAt("/review/2", "/review/:id", <ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText("The passage says so.")).toBeDefined();
    });
    expect(screen.getByText(/A reason/)).toBeDefined();
    // The second result carries no explanation, so only one Explanation block renders.
    expect(screen.getAllByText("Explanation")).toHaveLength(1);
  });

  // spec: §Behaviour.7–9 — wrong answers can be retried by band.
  it("offers a retry for the incorrect answers", async () => {
    stubFetch({ "GET /api/sessions/2": () => DETAIL });
    renderAt("/review/2", "/review/:id", <ReviewPage />);
    await waitFor(() => {
      expect(screen.getByText(/Retry incorrect questions/)).toBeDefined();
    });
    expect(screen.getByText(/1 incorrect answer in this session/)).toBeDefined();
  });
});
