// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, stubFetch } from "../../test-support/fetch";
import type { SessionConfig } from "./types";
import { useQuizSession } from "./useQuizSession";

// spec: docs/specs/quiz-session.md §Learning mode + §Real mode; docs/specs/reading-quiz-ui.md
// §Answering.7, 10; §Learning mode feedback.13; §Real mode.15, 17
//
// Drives the quiz hook in a real DOM against a stubbed `fetch`, so the client API layer
// (client/src/lib/api.ts — envelope unwrapping + ApiError mapping) runs for real underneath.

const QUESTIONS = [
  {
    id: 1,
    sequence: 1,
    text: "Q1 ?",
    passage: null,
    options: [
      { label: "A", text: "A" },
      { label: "B", text: "B" },
    ],
  },
  {
    id: 2,
    sequence: 2,
    text: "Q2 ?",
    passage: null,
    options: [
      { label: "A", text: "A" },
      { label: "B", text: "B" },
    ],
  },
];

const LEARNING: SessionConfig = {
  section: "reading",
  mode: "learning",
  difficulty: "beginner",
};
const REAL: SessionConfig = { section: "reading", mode: "real" };

const COMPLETE = {
  correct: 1,
  total: 2,
  pointsScored: 3,
  pointsPossible: 6,
};

function learningRoutes(overrides: Record<string, () => unknown> = {}) {
  return {
    "POST /api/sessions": () => ({
      sessionId: 7,
      questions: QUESTIONS,
      timeLimitMs: null,
    }),
    "POST /api/sessions/7/answers": () => ({
      isCorrect: true,
      correctLabel: "A",
      explanation: null,
    }),
    "POST /api/sessions/7/complete": () => COMPLETE,
    ...overrides,
  };
}

afterEach(() => {
  // Auto-cleanup is off without vitest `globals`, so unmount explicitly between tests.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useQuizSession — startup", () => {
  it("loads the session and becomes active", async () => {
    stubFetch(learningRoutes());
    const { result } = renderHook(() => useQuizSession(LEARNING));

    expect(result.current.status).toBe("loading");
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    expect(result.current.sessionId).toBe(7);
    expect(result.current.total).toBe(2);
    expect(result.current.question?.id).toBe(1);
    expect(result.current.remainingMs).toBeNull();
  });

  it("surfaces the API error message when the session cannot start", async () => {
    stubFetch({
      "POST /api/sessions": apiError(
        "ANSWER_KEY_MISSING",
        "Question 3 has no imported answer key.",
      ),
    });
    const { result } = renderHook(() => useQuizSession(LEARNING));

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBe(
      "Question 3 has no imported answer key.",
    );
  });

  // The effect guards against React StrictMode's deliberate double-invoke.
  it("creates the session only once when the effect re-runs", async () => {
    const stub = stubFetch(learningRoutes());
    const { result, rerender } = renderHook(() => useQuizSession(LEARNING));
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    rerender();
    expect(
      stub.calls.filter((c) => c.path === "/api/sessions"),
    ).toHaveLength(1);
  });
});

describe("useQuizSession — answering (learning mode)", () => {
  async function active() {
    const stub = stubFetch(learningRoutes());
    const hook = renderHook(() => useQuizSession(LEARNING));
    await waitFor(() => {
      expect(hook.result.current.status).toBe("active");
    });
    return { ...hook, stub };
  }

  // spec: §Answering.7 — selecting is a pending choice, nothing is recorded yet.
  it("records a pending selection without calling the API", async () => {
    const { result, stub } = await active();
    act(() => {
      result.current.select("B");
    });
    expect(result.current.selectedLabel).toBe("B");
    expect(stub.calls.filter((c) => c.path.includes("/answers"))).toHaveLength(
      0,
    );
  });

  // spec: §Answering.10 — confirm finalises the choice and reveals feedback.
  it("confirms the choice and exposes the feedback", async () => {
    const { result } = await active();
    act(() => {
      result.current.select("A");
    });
    await act(async () => {
      result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.feedback).not.toBeNull();
    });
    expect(result.current.feedback).toMatchObject({
      isCorrect: true,
      correctLabel: "A",
    });
  });

  it("ignores confirm with nothing selected", async () => {
    const { result, stub } = await active();
    act(() => {
      result.current.confirm();
    });
    expect(stub.calls.filter((c) => c.path.includes("/answers"))).toHaveLength(
      0,
    );
  });

  it("ignores a further selection once feedback is showing", async () => {
    const { result } = await active();
    act(() => {
      result.current.select("A");
    });
    await act(async () => {
      result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.feedback).not.toBeNull();
    });
    act(() => {
      result.current.select("B");
    });
    expect(result.current.selectedLabel).toBe("A");
  });

  // spec: §Learning mode feedback.13 — next clears the feedback and advances.
  it("advances to the next question, clearing selection and feedback", async () => {
    const { result } = await active();
    act(() => {
      result.current.select("A");
    });
    await act(async () => {
      result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.feedback).not.toBeNull();
    });
    act(() => {
      result.current.goNext();
    });
    expect(result.current.index).toBe(1);
    expect(result.current.question?.id).toBe(2);
    expect(result.current.feedback).toBeNull();
    expect(result.current.selectedLabel).toBeNull();
  });

  it("completes the session when advancing past the last question", async () => {
    const { result } = await active();
    act(() => {
      result.current.goNext();
    });
    await act(async () => {
      result.current.goNext();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.results).toEqual(COMPLETE);
    // Learning mode reports no elapsed time.
    expect(result.current.elapsedMs).toBeNull();
  });

  it("surfaces an error when recording the answer fails", async () => {
    const stub = stubFetch(learningRoutes());
    const hook = renderHook(() => useQuizSession(LEARNING));
    await waitFor(() => {
      expect(hook.result.current.status).toBe("active");
    });
    stub.set(
      "POST /api/sessions/7/answers",
      apiError("SESSION_NOT_FOUND", "Session 7 not found."),
    );
    act(() => {
      hook.result.current.select("A");
    });
    await act(async () => {
      hook.result.current.confirm();
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe("error");
    });
    expect(hook.result.current.error).toBe("Session 7 not found.");
  });

  it("surfaces an error when completing fails", async () => {
    const stub = stubFetch(learningRoutes());
    const hook = renderHook(() => useQuizSession(LEARNING));
    await waitFor(() => {
      expect(hook.result.current.status).toBe("active");
    });
    stub.set(
      "POST /api/sessions/7/complete",
      apiError("SESSION_NOT_FOUND", "Session 7 not found."),
    );
    act(() => {
      hook.result.current.goNext();
    });
    await act(async () => {
      hook.result.current.goNext();
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe("error");
    });
  });
});

describe("useQuizSession — real mode", () => {
  const realRoutes = {
    "POST /api/sessions": () => ({
      sessionId: 9,
      questions: QUESTIONS,
      timeLimitMs: 60_000,
    }),
    "POST /api/sessions/9/answers": () => ({ recorded: true }),
    "POST /api/sessions/9/complete": () => COMPLETE,
  };

  // spec: §Real mode.15 — no feedback; confirming auto-advances.
  it("auto-advances on confirm without showing feedback", async () => {
    stubFetch(realRoutes);
    const { result } = renderHook(() => useQuizSession(REAL));
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    act(() => {
      result.current.select("A");
    });
    await act(async () => {
      result.current.confirm();
    });
    await waitFor(() => {
      expect(result.current.index).toBe(1);
    });
    expect(result.current.feedback).toBeNull();
  });

  // spec: §Real mode.8 — the countdown is initialised from the server's limit and ticks down.
  it("initialises and decrements the countdown", async () => {
    vi.useFakeTimers();
    stubFetch(realRoutes);
    const { result } = renderHook(() => useQuizSession(REAL));
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    const first = result.current.remainingMs;
    expect(first).not.toBeNull();
    expect(first).toBeLessThanOrEqual(60_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.remainingMs).toBeLessThan(first!);
  });

  // spec: §Real mode.10 — reaching zero auto-submits the exam.
  it("auto-submits when the countdown reaches zero", async () => {
    vi.useFakeTimers();
    stubFetch(realRoutes);
    const { result } = renderHook(() => useQuizSession(REAL));
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.elapsedMs).toBe(60_000);
  });

  // spec: §Real mode.17 — the candidate can submit early; elapsed time is reported.
  it("submits early and reports the elapsed time", async () => {
    stubFetch(realRoutes);
    const { result } = renderHook(() => useQuizSession(REAL));
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    await act(async () => {
      result.current.submitExam();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.current.results).toEqual(COMPLETE);
  });

  // A double submit (button mashing, or early submit racing the timer) must complete only once.
  it("completes at most once", async () => {
    const stub = stubFetch(realRoutes);
    const { result } = renderHook(() => useQuizSession(REAL));
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    await act(async () => {
      result.current.submitExam();
      result.current.submitExam();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(
      stub.calls.filter((c) => c.path.endsWith("/complete")),
    ).toHaveLength(1);
  });
});
