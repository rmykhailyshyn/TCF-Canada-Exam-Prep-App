import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Harness, createHarness } from "./practice-routes.test-support";

// spec: docs/specs/content-deploy.md §Behaviour.5, 7; §Scope (online practice-only behaviour)
// DB-backed coverage for the SPEAKING half of the Worker's practice-only route extension: a recording
// upload stores the audio through the MediaStore and returns an empty transcript (no Whisper online),
// and complete reports a null overall score because no task is ever scored online.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.cleanup();
});

describe("practice routes (Worker practice-only) — speaking", () => {
  it("recording upload stores audio and returns an empty transcript", async () => {
    const app = h.makeApp();
    const sessionId = await h.seedSpeakingSession("learning");

    const form = new FormData();
    form.append(
      "audio",
      new File([new Uint8Array([1, 2, 3, 4])], "take.webm", {
        type: "audio/webm",
      }),
    );

    const res = await app.request(
      `/api/speaking/sessions/${sessionId}/responses/1`,
      { method: "POST", body: form },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        transcript: string;
        audioUrl: string;
        durationMs: number | null;
      } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.transcript).toBe("");
    expect(body.data?.durationMs).toBeNull();
    expect(body.data?.audioUrl).toBe(
      `/api/speaking/sessions/${sessionId}/responses/1/audio`,
    );

    // The bytes were persisted in the MediaStore and the row points at the stored key.
    expect(h.media.keys()).toContain(
      `speaking/session-${sessionId}-task-1.webm`,
    );
    const rows = await h.db.query.speakingResponses.findMany();
    const task1 = rows.find((r) => r.taskNumber === 1);
    expect(task1?.audioPath).toBe(`speaking/session-${sessionId}-task-1.webm`);
    expect(task1?.transcript).toBeNull();
  });

  it("complete finalises the session unscored (overallScore: null, submitted: 0)", async () => {
    const app = h.makeApp();
    const sessionId = await h.seedSpeakingSession("real");

    const res = await app.request(
      `/api/speaking/sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ elapsedMs: 5000 }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        overallScore: number | null;
        submitted: number;
        tasks: {
          taskNumber: number;
          score: number | null;
          level: string | null;
        }[];
      } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.overallScore).toBeNull();
    expect(body.data?.submitted).toBe(0);
    expect(
      body.data?.tasks.every((t) => t.score === null && t.level === null),
    ).toBe(true);

    const sessionRows = await h.db.query.sessions.findMany();
    expect(sessionRows[0]?.completedAt).not.toBeNull();
  });
});
