// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "../../lib/api";
import { CapabilitiesContext } from "../../lib/capabilities-context";
import { apiError, stubFetch } from "../../test-support/fetch";
import { countWords } from "./types";
import type { WritingConfig } from "./types";
import { useWritingSession } from "./useWritingSession";

// spec: docs/specs/writing-session.md + docs/specs/writing-ui.md §Editor.6, §Real mode.15
// spec: docs/specs/content-deploy.md §Behaviour.4 (online: submit locks without an evaluation)
//
// Drives the writing hook in a real DOM against a stubbed `fetch`, so client/src/lib/api.ts runs for
// real underneath. Draft autosave is debounced (800 ms), so those tests use fake timers.

const TASKS = [
  { taskNumber: 1, prompt: "Écrivez un message.", minWords: 60, maxWords: 120 },
  { taskNumber: 2, prompt: "Écrivez un article.", minWords: 120, maxWords: null },
  { taskNumber: 3, prompt: "Argumentez.", minWords: 120, maxWords: null },
];

const EVALUATION = {
  score: 15,
  level: "NCLC 7",
  feedback: { strengths: "s", errors: "e", improvements: "i" },
};

const LEARNING: WritingConfig = { mode: "learning" };
const REAL: WritingConfig = { mode: "real" };

const ONLINE: Capabilities = {
  aiScoring: false,
  transcription: false,
  imports: false,
};
const LOCAL: Capabilities = {
  aiScoring: true,
  transcription: true,
  imports: true,
};

function wrapperFor(caps: Capabilities) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CapabilitiesContext.Provider value={caps}>
        {children}
      </CapabilitiesContext.Provider>
    );
  };
}

function routes(timeLimitMs: number | null) {
  return {
    "POST /api/writing/sessions": () => ({
      sessionId: 3,
      tasks: TASKS,
      timeLimitMs,
    }),
    "PUT /api/writing/sessions/3/responses/1": (body: unknown) => ({
      wordCount: countWords((body as { text: string }).text),
    }),
    "PUT /api/writing/sessions/3/responses/2": () => ({ wordCount: 0 }),
    "POST /api/writing/sessions/3/responses/1/submit": () => EVALUATION,
    "POST /api/writing/sessions/3/correct/1": () => ({
      correctedText: "Version corrigée.",
      suggestions: ["accord"],
    }),
    "POST /api/writing/sessions/3/complete": () => ({
      tasks: [{ taskNumber: 1, score: 15, level: "NCLC 7" }],
      overallScore: 5,
      submitted: 1,
    }),
  };
}

async function activeSession(
  config = LEARNING,
  caps = LOCAL,
  timeLimitMs: number | null = null,
) {
  const stub = stubFetch(routes(timeLimitMs));
  const hook = renderHook(() => useWritingSession(config), {
    wrapper: wrapperFor(caps),
  });
  await waitFor(() => {
    expect(hook.result.current.status).toBe("active");
  });
  return { ...hook, stub };
}

afterEach(() => {
  // Auto-cleanup is off without vitest `globals`, so unmount explicitly between tests.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("countWords", () => {
  // spec: docs/specs/writing-ui.md §Editor.6 — whitespace-split, matching the server's count.
  it("counts whitespace-separated words and treats blank text as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords("un")).toBe(1);
    expect(countWords("  un   deux \n trois ")).toBe(3);
  });
});

describe("useWritingSession — startup", () => {
  it("loads the tasks and seeds empty drafts and counts", async () => {
    const { result } = await activeSession();
    expect(result.current.sessionId).toBe(3);
    expect(result.current.tasks).toHaveLength(3);
    expect(result.current.drafts).toEqual({ 1: "", 2: "", 3: "" });
    expect(result.current.counts).toEqual({ 1: 0, 2: 0, 3: 0 });
    expect(result.current.remainingMs).toBeNull();
  });

  it("surfaces the API error message when the session cannot start", async () => {
    stubFetch({
      "POST /api/writing/sessions": apiError(
        "NO_TASKS",
        "No writing tasks have been imported.",
      ),
    });
    const { result } = renderHook(() => useWritingSession(LEARNING), {
      wrapper: wrapperFor(LOCAL),
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBe("No writing tasks have been imported.");
  });
});

describe("useWritingSession — drafts", () => {
  it("updates the draft and its word count immediately", async () => {
    const { result } = await activeSession();
    act(() => {
      result.current.setDraft(1, "Bonjour tout le monde");
    });
    expect(result.current.drafts[1]).toBe("Bonjour tout le monde");
    expect(result.current.counts[1]).toBe(4);
  });

  it("debounces the autosave, sending one request per pause", async () => {
    vi.useFakeTimers();
    const stub = stubFetch(routes(null));
    const { result } = renderHook(() => useWritingSession(LEARNING), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });

    act(() => {
      result.current.setDraft(1, "un");
      result.current.setDraft(1, "un deux");
      result.current.setDraft(1, "un deux trois");
    });
    expect(stub.calls.filter((c) => c.method === "PUT")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    const puts = stub.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ text: "un deux trois" });
  });

  it("saveNow flushes the pending draft without waiting for the debounce", async () => {
    const { result, stub } = await activeSession();
    act(() => {
      result.current.setDraft(1, "texte immédiat");
      result.current.saveNow(1);
    });
    await waitFor(() => {
      expect(stub.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    });
  });

  // Autosave is best-effort — a failure must not surface as a task error or break the session.
  it("swallows an autosave failure", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "PUT /api/writing/sessions/3/responses/1",
      apiError("BAD_REQUEST", "nope"),
    );
    await act(async () => {
      result.current.saveNow(1);
    });
    expect(result.current.status).toBe("active");
    expect(result.current.taskError[1]).toBeUndefined();
  });
});

describe("useWritingSession — submit and correct", () => {
  it("stores the returned evaluation for the task", async () => {
    const { result } = await activeSession();
    act(() => {
      result.current.setDraft(1, "Une réponse assez longue.");
    });
    await act(async () => {
      result.current.submit(1);
    });
    await waitFor(() => {
      expect(result.current.evaluations[1]).toBeDefined();
    });
    expect(result.current.evaluations[1]).toMatchObject({ score: 15 });
    expect(result.current.busyTask).toBeNull();
  });

  // spec: docs/specs/content-deploy.md §Behaviour.4 — online, submit locks without an evaluation.
  it("records no evaluation when the server returns a null score", async () => {
    const { result, stub } = await activeSession(LEARNING, ONLINE);
    stub.set("POST /api/writing/sessions/3/responses/1/submit", () => ({
      score: null,
      level: null,
      feedback: null,
    }));
    await act(async () => {
      result.current.submit(1);
    });
    await waitFor(() => {
      expect(result.current.busyTask).toBeNull();
    });
    expect(result.current.evaluations[1]).toBeUndefined();
  });

  it("records a per-task error when scoring fails", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "POST /api/writing/sessions/3/responses/1/submit",
      apiError("EVALUATION_FAILED", "Could not score the response."),
    );
    await act(async () => {
      result.current.submit(1);
    });
    await waitFor(() => {
      expect(result.current.taskError[1]).toBe("Could not score the response.");
    });
    // The session itself stays usable.
    expect(result.current.status).toBe("active");
  });

  it("stores a requested correction", async () => {
    const { result } = await activeSession();
    await act(async () => {
      result.current.correct(1);
    });
    await waitFor(() => {
      expect(result.current.corrections[1]).toBeDefined();
    });
    expect(result.current.corrections[1].correctedText).toBe(
      "Version corrigée.",
    );
  });

  // spec: docs/specs/content-deploy.md §Behaviour.4 — no correction endpoint online.
  it("does not request a correction when aiScoring is off", async () => {
    const { result, stub } = await activeSession(LEARNING, ONLINE);
    await act(async () => {
      result.current.correct(1);
    });
    expect(
      stub.calls.filter((c) => c.path.includes("/correct/")),
    ).toHaveLength(0);
    expect(result.current.corrections[1]).toBeUndefined();
  });

  it("records a per-task error when the correction fails", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "POST /api/writing/sessions/3/correct/1",
      apiError("CORRECTION_FAILED", "Could not produce a correction."),
    );
    await act(async () => {
      result.current.correct(1);
    });
    await waitFor(() => {
      expect(result.current.taskError[1]).toBe(
        "Could not produce a correction.",
      );
    });
  });
});

describe("useWritingSession — completion", () => {
  it("finishes a training session with no elapsed time", async () => {
    const { result } = await activeSession();
    await act(async () => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.elapsedMs).toBeNull();
    expect(result.current.results).toMatchObject({ submitted: 1 });
  });

  it("surfaces an error when completing fails", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "POST /api/writing/sessions/3/complete",
      apiError("SESSION_NOT_FOUND", "Session 3 not found."),
    );
    await act(async () => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
  });

  it("completes at most once", async () => {
    const { result, stub } = await activeSession();
    await act(async () => {
      result.current.finish();
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(
      stub.calls.filter((c) => c.path.endsWith("/complete")),
    ).toHaveLength(1);
  });

  // spec: docs/specs/writing-ui.md §Real mode.15 — the single 60-min budget auto-submits at zero.
  it("runs the real-mode countdown and auto-submits at zero", async () => {
    vi.useFakeTimers();
    const stub = stubFetch(routes(60_000));
    const { result } = renderHook(() => useWritingSession(REAL), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    expect(result.current.remainingMs).toBeLessThanOrEqual(60_000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.remainingMs).toBe(0);
    expect(result.current.elapsedMs).toBe(60_000);
    expect(
      stub.calls.filter((c) => c.path.endsWith("/complete")),
    ).toHaveLength(1);
  });

  it("submits the exam early with the elapsed time", async () => {
    const { result } = await activeSession(REAL, LOCAL, 60_000);
    await act(async () => {
      result.current.submitExam();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
