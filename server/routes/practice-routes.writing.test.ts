import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Harness,
  createHarness,
  stubLlm,
} from "./practice-routes.test-support";

// spec: docs/specs/content-deploy.md §Behaviour.4, 7; docs/specs/llm-provider.md §Behaviour.8
// DB-backed coverage for the WRITING half of the Worker's practice-only route extension: submit
// locks the draft without an evaluation and complete finalises unscored, unless an `llm` provider is
// bound — then both score for real through the portable writing-scoring.ts service.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.cleanup();
});

describe("practice routes (Worker practice-only) — writing", () => {
  it("submit locks the draft and returns score: null with no evaluation", async () => {
    const app = h.makeApp();
    const sessionId = await h.seedWritingSession("learning");

    const res = await app.request(
      `/api/writing/sessions/${sessionId}/responses/1/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Bonjour le monde encore" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        wordCount: number;
        submitted: boolean;
        score: null;
        level: null;
        feedback: null;
      } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.submitted).toBe(true);
    expect(body.data?.wordCount).toBe(4);
    expect(body.data?.score).toBeNull();
    expect(body.data?.level).toBeNull();
    expect(body.data?.feedback).toBeNull();

    // The lock must persist submittedAt on the response row.
    const rows = await h.db.query.writingResponses.findMany();
    const task1 = rows.find((r) => r.taskNumber === 1);
    expect(task1?.submittedAt).not.toBeNull();
    expect(task1?.responseText).toBe("Bonjour le monde encore");
    // No evaluation row was ever created online.
    const evals = await h.db.query.writingEvaluations.findMany();
    expect(evals).toHaveLength(0);
  });

  it("complete finalises the session unscored (overallScore: null, submitted: 0)", async () => {
    const app = h.makeApp();
    const sessionId = await h.seedWritingSession("real");

    const res = await app.request(
      `/api/writing/sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ elapsedMs: 1234 }),
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

    // completedAt is stamped on the session.
    const sessionRows = await h.db.query.sessions.findMany();
    expect(sessionRows[0]?.completedAt).not.toBeNull();
  });
});

// spec: docs/specs/llm-provider.md §Behaviour.8 — when the Worker has an `llm` provider (API key
// bound), writing submit/complete/correct score for real instead of locking; speaking is unaffected
// (Worker Speaking scoring is deferred). A stub provider replaces the real Messages API call.
describe("practice routes (Worker online scoring, llm-provider.md §Behaviour.8)", () => {
  const scoreReply = JSON.stringify({
    score: 15,
    strengths: "Clear structure.",
    errors: "A few agreement slips.",
    improvements: "Vary the connectors.",
  });
  const correctionReply = JSON.stringify({
    correctedText: "Bonjour le monde, encore.",
    suggestions: ["Add a comma before 'encore'."],
  });

  it("submit scores for real and persists an evaluation with claude-api provenance", async () => {
    const app = h.makeApp(stubLlm(scoreReply));
    const sessionId = await h.seedWritingSession("learning");

    const res = await app.request(
      `/api/writing/sessions/${sessionId}/responses/1/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Bonjour le monde encore" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        score: number;
        level: string;
        feedback: { strengths: string };
      } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.score).toBe(15);
    expect(body.data?.feedback.strengths).toBe("Clear structure.");

    const evals = await h.db.query.writingEvaluations.findMany();
    expect(evals).toHaveLength(1);
    expect(evals[0]?.generatedBy).toBe("claude-api/claude-opus-4-8");
  });

  it("correct produces a correction (training only) instead of 404", async () => {
    const app = h.makeApp(stubLlm(correctionReply));
    const sessionId = await h.seedWritingSession("learning");

    const res = await app.request(
      `/api/writing/sessions/${sessionId}/correct/1`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Bonjour le monde encore" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { correctedText: string; suggestions: string[] } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.correctedText).toBe("Bonjour le monde, encore.");
  });

  it("complete scores unscored real-mode tasks instead of leaving overallScore null", async () => {
    const app = h.makeApp(stubLlm(scoreReply));
    const sessionId = await h.seedWritingSession("real");

    const res = await app.request(
      `/api/writing/sessions/${sessionId}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ elapsedMs: 1234 }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { overallScore: number | null; submitted: number } | null;
      error: unknown;
    };
    expect(body.error).toBeNull();
    expect(body.data?.overallScore).toBe(15);
    expect(body.data?.submitted).toBe(3);
  });
});
