// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "../../lib/api";
import { CapabilitiesContext } from "../../lib/capabilities-context";
import { apiError, stubFetch } from "../../test-support/fetch";
import { stubMedia } from "../../test-support/media";
import { preferredAudioMime } from "./types";
import type { SpeakingConfig } from "./types";
import { useSpeakingSession } from "./useSpeakingSession";

// spec: docs/specs/speaking-session.md + docs/specs/speaking-ui.md §Recorder (Behaviour.5–7),
// §Real mode (Behaviour.12–14); docs/specs/speaking-evaluation.md §Behaviour.3–5;
// docs/specs/content-deploy.md §Behaviour.5 (online: no submit/correct)
//
// Drives the speaking hook in a real DOM. `fetch`, MediaRecorder, getUserMedia and URL object-URLs
// are all stubbed (see client/src/test-support), so the real client/src/lib/api.ts runs underneath
// while the browser media APIs jsdom lacks are simulated.

const TASKS = [
  { taskNumber: 1, question: "Parlez de vous.", sampleAnswer: null },
  { taskNumber: 2, question: "Posez des questions.", sampleAnswer: null },
];
const TIMING = [
  { taskNumber: 1, prepSeconds: 2, recordSeconds: 3 },
  { taskNumber: 2, prepSeconds: 2, recordSeconds: 3 },
];

const EVALUATION = {
  score: 13,
  level: "NCLC 6",
  feedback: { strengths: "s", errors: "e", improvements: "i" },
};

const LOCAL: Capabilities = {
  aiScoring: true,
  transcription: true,
  imports: true,
};
const ONLINE: Capabilities = {
  aiScoring: false,
  transcription: false,
  imports: false,
};

const LEARNING: SpeakingConfig = { mode: "learning" };
const REAL: SpeakingConfig = { mode: "real" };

function wrapperFor(caps: Capabilities) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CapabilitiesContext.Provider value={caps}>
        {children}
      </CapabilitiesContext.Provider>
    );
  };
}

function routes(timing: typeof TIMING | null) {
  return {
    "POST /api/speaking/sessions": () => ({
      sessionId: 5,
      tasks: TASKS,
      timing,
    }),
    "POST /api/speaking/sessions/5/responses/1": () => ({
      transcript: "Je m'appelle Marie.",
      audioUrl: "/api/speaking/sessions/5/responses/1/audio",
      durationMs: 3000,
    }),
    "POST /api/speaking/sessions/5/responses/2": () => ({
      transcript: "Deuxième réponse.",
      audioUrl: "/api/speaking/sessions/5/responses/2/audio",
      durationMs: 3000,
    }),
    "POST /api/speaking/sessions/5/responses/1/submit": () => EVALUATION,
    "POST /api/speaking/sessions/5/correct/1": () => ({
      correctedText: "Version corrigée.",
      suggestions: ["liaison"],
    }),
    "POST /api/speaking/sessions/5/complete": () => ({
      tasks: [{ taskNumber: 1, score: 13, level: "NCLC 6" }],
      overallScore: 7,
      submitted: 1,
    }),
  };
}

async function activeSession(
  config = LEARNING,
  caps = LOCAL,
  timing: typeof TIMING | null = null,
) {
  const media = stubMedia();
  const stub = stubFetch(routes(timing));
  const hook = renderHook(() => useSpeakingSession(config), {
    wrapper: wrapperFor(caps),
  });
  await waitFor(() => {
    expect(hook.result.current.status).toBe("active");
  });
  return { ...hook, stub, media };
}

afterEach(() => {
  // Auto-cleanup is off without vitest `globals`, so unmount explicitly between tests.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("preferredAudioMime", () => {
  // spec: docs/specs/speaking-ui.md §Open questions (1) — prefer Opus-in-WebM.
  it("picks the first candidate the browser supports", () => {
    stubMedia();
    expect(preferredAudioMime()).toBe("audio/webm;codecs=opus");
  });

  it("returns an empty string when MediaRecorder is unavailable", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(preferredAudioMime()).toBe("");
  });
});

describe("useSpeakingSession — startup", () => {
  it("loads the tasks and becomes active", async () => {
    const { result } = await activeSession();
    expect(result.current.sessionId).toBe(5);
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.recordingTask).toBeNull();
  });

  it("surfaces the API error message when the session cannot start", async () => {
    stubMedia();
    stubFetch({
      "POST /api/speaking/sessions": apiError(
        "NO_TASKS",
        "No speaking tasks have been imported.",
      ),
    });
    const { result } = renderHook(() => useSpeakingSession(LEARNING), {
      wrapper: wrapperFor(LOCAL),
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current.error).toBe("No speaking tasks have been imported.");
  });
});

describe("useSpeakingSession — recording", () => {
  it("starts a recording and marks the task as live", async () => {
    const { result, media } = await activeSession();
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
    expect(media.latest()?.state).toBe("recording");
    expect(result.current.micError).toBeNull();
  });

  // Only one take at a time — a second start while recording must be ignored.
  it("ignores a second start while already recording", async () => {
    const { result } = await activeSession();
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
    await act(async () => {
      result.current.startRecording(2);
    });
    expect(result.current.recordingTask).toBe(1);
  });

  it("reports a mic-permission failure without breaking the session", async () => {
    stubMedia({ grantMic: false });
    stubFetch(routes(null));
    const { result } = renderHook(() => useSpeakingSession(LEARNING), {
      wrapper: wrapperFor(LOCAL),
    });
    await waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.micError).toMatch(/Microphone access was denied/);
    });
    expect(result.current.recordingTask).toBeNull();
    expect(result.current.status).toBe("active");
  });

  // spec: docs/specs/speaking-evaluation.md §Behaviour.3–5 — stopping uploads and stores the transcript.
  it("uploads the take on stop and stores the transcript", async () => {
    const { result, media } = await activeSession();
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
    await act(async () => {
      result.current.stopRecording();
    });
    await waitFor(() => {
      expect(result.current.transcripts[1]).toBe("Je m'appelle Marie.");
    });
    expect(result.current.recordings[1]?.url).toMatch(/^blob:/);
    expect(result.current.uploading[1]).toBe(false);
    // The mic stream is released once the take ends.
    expect(media.stoppedTracks()).toBeGreaterThan(0);
  });

  it("records a per-task error when the upload fails", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "POST /api/speaking/sessions/5/responses/1",
      apiError("TRANSCRIPTION_FAILED", "Could not transcribe the recording."),
    );
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
    await act(async () => {
      result.current.stopRecording();
    });
    await waitFor(() => {
      expect(result.current.taskError[1]).toBe(
        "Could not transcribe the recording.",
      );
    });
    expect(result.current.uploading[1]).toBe(false);
  });

  // spec: docs/specs/speaking-session.md §Behaviour.15 — a new take replaces the prior one.
  it("revokes the previous blob URL when a task is re-recorded", async () => {
    const { result, media } = await activeSession();
    for (let take = 0; take < 2; take += 1) {
      await act(async () => {
        result.current.startRecording(1);
      });
      await waitFor(() => {
        expect(result.current.recordingTask).toBe(1);
      });
      await act(async () => {
        result.current.stopRecording();
      });
      await waitFor(() => {
        expect(result.current.uploading[1]).toBe(false);
      });
    }
    expect(media.revoked()).toContain("blob:take-1");
    expect(result.current.recordings[1]?.url).toBe("blob:take-2");
  });

  it("stopRecording is a safe no-op when nothing is recording", async () => {
    const { result } = await activeSession();
    act(() => {
      result.current.stopRecording();
    });
    expect(result.current.recordingTask).toBeNull();
  });

  // Leaving the page must release the mic and every captured object URL.
  it("releases the stream and blob URLs on unmount", async () => {
    const { result, unmount, media } = await activeSession();
    await act(async () => {
      result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
    await act(async () => {
      result.current.stopRecording();
    });
    await waitFor(() => {
      expect(result.current.recordings[1]).toBeDefined();
    });
    unmount();
    expect(media.revoked()).toContain("blob:take-1");
  });
});

describe("useSpeakingSession — submit and correct", () => {
  async function recorded() {
    const ctx = await activeSession();
    await act(async () => {
      ctx.result.current.startRecording(1);
    });
    await waitFor(() => {
      expect(ctx.result.current.recordingTask).toBe(1);
    });
    await act(async () => {
      ctx.result.current.stopRecording();
    });
    await waitFor(() => {
      expect(ctx.result.current.transcripts[1]).toBeDefined();
    });
    return ctx;
  }

  it("stores the evaluation for a submitted task", async () => {
    const { result } = await recorded();
    await act(async () => {
      result.current.submit(1);
    });
    await waitFor(() => {
      expect(result.current.evaluations[1]).toBeDefined();
    });
    expect(result.current.evaluations[1]).toMatchObject({ score: 13 });
    expect(result.current.busyTask).toBeNull();
  });

  it("records a per-task error when scoring fails", async () => {
    const { result, stub } = await recorded();
    stub.set(
      "POST /api/speaking/sessions/5/responses/1/submit",
      apiError("EVALUATION_FAILED", "Could not score the response."),
    );
    await act(async () => {
      result.current.submit(1);
    });
    await waitFor(() => {
      expect(result.current.taskError[1]).toBe("Could not score the response.");
    });
  });

  it("stores a requested correction", async () => {
    const { result } = await recorded();
    await act(async () => {
      result.current.correct(1);
    });
    await waitFor(() => {
      expect(result.current.corrections[1]).toBeDefined();
    });
  });

  it("records a per-task error when the correction fails", async () => {
    const { result, stub } = await recorded();
    stub.set(
      "POST /api/speaking/sessions/5/correct/1",
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

  // spec: docs/specs/content-deploy.md §Behaviour.5 — neither endpoint exists online.
  it("does not submit or correct when aiScoring is off", async () => {
    const { result, stub } = await activeSession(LEARNING, ONLINE);
    await act(async () => {
      result.current.submit(1);
      result.current.correct(1);
    });
    expect(
      stub.calls.filter(
        (c) => c.path.includes("/submit") || c.path.includes("/correct/"),
      ),
    ).toHaveLength(0);
  });
});

describe("useSpeakingSession — completion", () => {
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

  it("submits the exam early with the elapsed time", async () => {
    const { result } = await activeSession(REAL, LOCAL, null);
    await act(async () => {
      result.current.submitExam();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  // Unlike the quiz hook, a failed complete clears the guard so the user can retry without reloading.
  it("allows a retry after a failed completion", async () => {
    const { result, stub } = await activeSession();
    stub.set(
      "POST /api/speaking/sessions/5/complete",
      apiError("SESSION_NOT_FOUND", "Session 5 not found."),
    );
    await act(async () => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });

    stub.set("POST /api/speaking/sessions/5/complete", () => ({
      tasks: [],
      overallScore: 0,
      submitted: 0,
    }));
    await act(async () => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
  });
});

describe("useSpeakingSession — real-mode phase driver", () => {
  // spec: docs/specs/speaking-ui.md §Real mode.12 — prep countdown, then recording starts by itself.
  it("counts down the prep phase then starts recording automatically", async () => {
    vi.useFakeTimers();
    stubMedia();
    stubFetch(routes(TIMING));
    const { result } = renderHook(() => useSpeakingSession(REAL), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    expect(result.current.realPhase).toBe("prep");
    expect(result.current.phaseRemainingMs).toBeLessThanOrEqual(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await vi.waitFor(() => {
      expect(result.current.realPhase).toBe("recording");
    });
    await vi.waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });
  });

  // Each phase transition is driven in its own act() so React flushes the effect (and starts the
  // NEXT phase's interval) before the timers are advanced again — a single long advance would only
  // ever run the first phase's interval.
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // spec: §Real mode.13 — the recording auto-stops at the limit, uploads, and advances.
  it("auto-stops at the record limit, uploads, and advances to the next task", async () => {
    vi.useFakeTimers();
    stubMedia();
    stubFetch(routes(TIMING));
    const { result } = renderHook(() => useSpeakingSession(REAL), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });

    await advance(2100); // prep elapses → recording
    await vi.waitFor(() => {
      expect(result.current.recordingTask).toBe(1);
    });

    await advance(3100); // record limit reached → stop → upload
    await vi.waitFor(() => {
      expect(result.current.transcripts[1]).toBe("Je m'appelle Marie.");
    });
    await vi.waitFor(() => {
      expect(result.current.currentIndex).toBe(1);
    });
    expect(result.current.realPhase).toBe("prep");
  });

  // spec: §Real mode.14 — after the last task the session completes on its own.
  it("completes the session after the final task", async () => {
    vi.useFakeTimers();
    stubMedia();
    stubFetch(routes(TIMING));
    const { result } = renderHook(() => useSpeakingSession(REAL), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });

    // Two full task cycles: prep (2s) then record (3s), each advanced separately.
    for (const taskIndex of [0, 1]) {
      await advance(2100);
      await vi.waitFor(() => {
        expect(result.current.recordingTask).toBe(taskIndex + 1);
      });
      await advance(3100);
      await vi.waitFor(() => {
        expect(result.current.transcripts[taskIndex + 1]).toBeDefined();
      });
    }

    await vi.waitFor(() => {
      expect(result.current.status).toBe("finished");
    });
    expect(result.current.results).toMatchObject({ submitted: 1 });
  });

  // A task configured with no prep time goes straight to recording.
  it("skips a zero-length prep phase", async () => {
    vi.useFakeTimers();
    stubMedia();
    stubFetch(
      routes([
        { taskNumber: 1, prepSeconds: 0, recordSeconds: 3 },
        { taskNumber: 2, prepSeconds: 0, recordSeconds: 3 },
      ]),
    );
    const { result } = renderHook(() => useSpeakingSession(REAL), {
      wrapper: wrapperFor(LOCAL),
    });
    await vi.waitFor(() => {
      expect(result.current.status).toBe("active");
    });
    await vi.waitFor(() => {
      expect(result.current.realPhase).toBe("recording");
    });
  });

  // Training mode has no timers at all — the user drives every take manually.
  it("runs no phase timer in training mode", async () => {
    const { result } = await activeSession(LEARNING, LOCAL, TIMING);
    expect(result.current.phaseRemainingMs).toBeNull();
    expect(result.current.recordingTask).toBeNull();
  });
});
