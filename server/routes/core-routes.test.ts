import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreApp } from "../app";
import {
  audioFiles,
  options,
  passages,
  questions,
  speakingResponses,
  speakingTasks,
  transcriptSegments,
  writingTasks,
} from "../db/schema";
import { nodeCapabilities } from "../runtime/capabilities";
import { type TestDb, cleanupDbs, freshDb } from "../test-support/db";
import { type FakeMediaStore, fakeMediaStore } from "../test-support/fakes";
import type { AppVars } from "./app-vars";

// spec: docs/specs/quiz-session.md, progress-tracking.md, question-export-import.md,
// listening-player.md, reading-quiz-ui.md, writing-session.md, speaking-session.md §API contract
// spec: docs/specs/server-runtime.md §Behaviour.2 (envelope), §Behaviour.6 (media + range)
//
// Drives the ENTIRE portable core (createCoreApp) over `app.request()` with the same AppVars the Node
// and Worker entries inject, against a real migrated SQLite database and an in-memory MediaStore.
// This is the route layer's contract: input validation, the {data,error} envelope, HTTP status
// mapping, and byte streaming — the service internals have their own suites.

let db: TestDb;
let media: FakeMediaStore;
let app: Hono<{ Variables: AppVars }>;

beforeEach(async () => {
  db = await freshDb();
  media = fakeMediaStore();
  // Same wiring order as the Node entry (server/index.ts): inject the per-request dependencies on an
  // outer app FIRST, then mount the portable core. Registering the middleware on the core after its
  // routers are mounted would never run for them.
  app = new Hono<{ Variables: AppVars }>();
  app.use("*", (c, next) => {
    c.set("db", db);
    c.set("mediaStore", media);
    c.set("capabilities", nodeCapabilities);
    return next();
  });
  app.route("/", createCoreApp());
});

afterEach(() => {
  cleanupDbs();
});

type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };

async function json<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

// `app.request` is typed `Response | Promise<Response>`; await normalises it for the callers.
async function post(path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** One keyed reading question at `sequence`, returning its id. */
async function seedReading(sequence = 1, withPassage = false): Promise<number> {
  let passageId: number | null = null;
  if (withPassage) {
    const [p] = await db
      .insert(passages)
      .values({ sourceFile: "reading/q1.png", text: "Le texte." })
      .returning({ id: passages.id });
    passageId = p.id;
  }
  const [q] = await db
    .insert(questions)
    .values({
      passageId,
      sourceFile: "reading.pdf",
      sequence,
      text: `Question ${String(sequence)} ?`,
      section: "reading",
    })
    .returning({ id: questions.id });
  for (const label of ["A", "B", "C", "D"] as const) {
    await db.insert(options).values({
      questionId: q.id,
      label,
      text: `Option ${label}`,
      isCorrect: label === "A",
    });
  }
  return q.id;
}

describe("GET /api/health", () => {
  // spec: docs/specs/server-runtime.md §Behaviour.4 — capabilities drive client feature gating.
  it("reports status and the runtime capability flags", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await json<{ status: string; capabilities: unknown }>(res);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      status: "ok",
      capabilities: nodeCapabilities,
    });
  });
});

describe("POST /api/sessions", () => {
  it("rejects a missing or unknown section", async () => {
    const res = await post("/api/sessions", { mode: "real" });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.data).toBeNull();
    expect(body.error).toMatchObject({ code: "BAD_REQUEST" });
    expect(body.error?.message).toContain("section");
  });

  it("rejects an unknown mode", async () => {
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "sandbox",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("mode");
  });

  it("rejects a body that is not valid JSON", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("BAD_REQUEST");
  });

  it("rejects non-integer question ids", async () => {
    await seedReading();
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
      questionIds: ["1"],
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("questionIds");
  });

  it("creates a real session and returns the question set in an ok envelope", async () => {
    await seedReading();
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "real",
    });
    expect(res.status).toBe(200);
    const body = await json<{
      sessionId: number;
      questions: unknown[];
      timeLimitMs: number;
    }>(res);
    expect(body.error).toBeNull();
    expect(body.data?.questions).toHaveLength(1);
    expect(body.data?.timeLimitMs).toBeGreaterThan(0);
  });

  it("maps a service ApiError onto its code and status", async () => {
    await seedReading();
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "learning",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("INVALID_DIFFICULTY");
  });

  it("passes an explicit questionIds retry list through to the service", async () => {
    const id = await seedReading();
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
      questionIds: [id],
    });
    expect(res.status).toBe(200);
    const body = await json<{ questions: { id: number }[] }>(res);
    expect(body.data?.questions.map((q) => q.id)).toEqual([id]);
  });
});

describe("POST /api/sessions/:id/answers", () => {
  async function startSession(): Promise<{
    sessionId: number;
    questionId: number;
  }> {
    const questionId = await seedReading();
    const res = await post("/api/sessions", {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    const body = await json<{ sessionId: number }>(res);
    return { sessionId: body.data!.sessionId, questionId };
  }

  it("rejects a non-numeric session id", async () => {
    const res = await post("/api/sessions/abc/answers", {
      questionId: 1,
      chosenLabel: "A",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("session id");
  });

  it("rejects a non-integer questionId", async () => {
    const { sessionId } = await startSession();
    const res = await post(`/api/sessions/${String(sessionId)}/answers`, {
      questionId: "1",
      chosenLabel: "A",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("questionId");
  });

  it("rejects a label outside A–D", async () => {
    const { sessionId, questionId } = await startSession();
    const res = await post(`/api/sessions/${String(sessionId)}/answers`, {
      questionId,
      chosenLabel: "E",
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("chosenLabel");
  });

  // spec: docs/specs/quiz-session.md §Learning mode — feedback is returned per answer.
  it("returns learning-mode feedback", async () => {
    const { sessionId, questionId } = await startSession();
    const res = await post(`/api/sessions/${String(sessionId)}/answers`, {
      questionId,
      chosenLabel: "A",
    });
    expect(res.status).toBe(200);
    const body = await json<{ isCorrect: boolean; correctLabel: string }>(res);
    expect(body.data).toMatchObject({ isCorrect: true, correctLabel: "A" });
  });

  // spec: §Behaviour.9 — real mode acknowledges without revealing correctness.
  it("acknowledges a real-mode answer without leaking the key", async () => {
    const questionId = await seedReading();
    const created = await json<{ sessionId: number }>(
      await post("/api/sessions", { section: "reading", mode: "real" }),
    );
    const res = await post(
      `/api/sessions/${String(created.data!.sessionId)}/answers`,
      { questionId, chosenLabel: "B" },
    );
    const body = await json<Record<string, unknown>>(res);
    expect(body.data).toEqual({ recorded: true });
  });

  it("propagates the service 404 for an unknown session", async () => {
    const questionId = await seedReading();
    const res = await post("/api/sessions/9999/answers", {
      questionId,
      chosenLabel: "A",
    });
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe("SESSION_NOT_FOUND");
  });
});

describe("POST /api/sessions/:id/complete", () => {
  it("rejects a non-numeric session id", async () => {
    const res = await post("/api/sessions/xyz/complete", {});
    expect(res.status).toBe(400);
  });

  it("completes a session and returns the score", async () => {
    await seedReading();
    const created = await json<{ sessionId: number }>(
      await post("/api/sessions", {
        section: "reading",
        mode: "learning",
        difficulty: "beginner",
      }),
    );
    const res = await post(
      `/api/sessions/${String(created.data!.sessionId)}/complete`,
      { elapsedMs: 1000 },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ correct: 0, total: 1 });
  });

  it("treats a non-integer elapsedMs as absent rather than failing", async () => {
    await seedReading();
    const created = await json<{ sessionId: number }>(
      await post("/api/sessions", { section: "reading", mode: "real" }),
    );
    const res = await post(
      `/api/sessions/${String(created.data!.sessionId)}/complete`,
      { elapsedMs: "soon" },
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/sessions and /api/sessions/:id", () => {
  it("lists an empty history", async () => {
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    expect((await json<{ sessions: unknown[] }>(res)).data?.sessions).toEqual(
      [],
    );
  });

  it("rejects a non-numeric detail id", async () => {
    const res = await app.request("/api/sessions/not-a-number");
    expect(res.status).toBe(400);
  });

  it("404s an unknown session detail", async () => {
    const res = await app.request("/api/sessions/4242");
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe("SESSION_NOT_FOUND");
  });

  it("returns the detail of a completed session", async () => {
    const questionId = await seedReading();
    const created = await json<{ sessionId: number }>(
      await post("/api/sessions", {
        section: "reading",
        mode: "learning",
        difficulty: "beginner",
      }),
    );
    const sessionId = created.data!.sessionId;
    await post(`/api/sessions/${String(sessionId)}/answers`, {
      questionId,
      chosenLabel: "A",
    });
    await post(`/api/sessions/${String(sessionId)}/complete`, {});

    const res = await app.request(`/api/sessions/${String(sessionId)}`);
    expect(res.status).toBe(200);
    const body = await json<{
      session: { correct: number };
      results: unknown[];
    }>(res);
    expect(body.data?.session.correct).toBe(1);
    expect(body.data?.results).toHaveLength(1);
  });
});

describe("GET /api/questions/export", () => {
  it("defaults to every section and band", async () => {
    await seedReading();
    const res = await app.request("/api/questions/export");
    expect(res.status).toBe(200);
    const body = await json<{ questions: unknown[]; filter: unknown }>(res);
    expect(body.data?.filter).toEqual({
      section: "all",
      difficulties: "all",
    });
    expect(body.data?.questions).toHaveLength(1);
  });

  it("honours the section + difficulty query filters", async () => {
    await seedReading(1);
    await seedReading(11);
    const res = await app.request(
      "/api/questions/export?section=reading&difficulty=intermediate",
    );
    const body = await json<{ questions: { sequence: number }[] }>(res);
    expect(body.data?.questions.map((q) => q.sequence)).toEqual([11]);
  });

  it("rejects an unknown section filter", async () => {
    const res = await app.request("/api/questions/export?section=writing");
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("INVALID_SECTION");
  });

  it("rejects an unknown difficulty slug", async () => {
    const res = await app.request("/api/questions/export?difficulty=wizard");
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("INVALID_DIFFICULTY");
  });

  it("accepts a comma-separated difficulty list", async () => {
    await seedReading(1);
    await seedReading(11);
    const res = await app.request(
      "/api/questions/export?difficulty=beginner,intermediate",
    );
    const body = await json<{ questions: unknown[] }>(res);
    expect(body.data?.questions).toHaveLength(2);
  });
});

describe("GET /api/questions/:id/audio", () => {
  async function seedAudio(bytes: number): Promise<number> {
    const [q] = await db
      .insert(questions)
      .values({
        sourceFile: "listening.pdf",
        sequence: 1,
        text: "Écoutez.",
        section: "listening",
      })
      .returning({ id: questions.id });
    await db
      .insert(audioFiles)
      .values({ questionId: q.id, filePath: "listening/q1.mp3", durationMs: 1 });
    await media.put(
      "listening/q1.mp3",
      new Uint8Array(Array.from({ length: bytes }, (_, i) => i % 256)),
      "audio/mpeg",
    );
    return q.id;
  }

  it("rejects a non-numeric question id", async () => {
    const res = await app.request("/api/questions/abc/audio");
    expect(res.status).toBe(400);
  });

  it("404s a question with no audio row", async () => {
    const id = await seedReading();
    const res = await app.request(`/api/questions/${String(id)}/audio`);
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe("NOT_FOUND");
  });

  it("404s when the row exists but the object is absent from the store", async () => {
    const [q] = await db
      .insert(questions)
      .values({
        sourceFile: "listening.pdf",
        sequence: 2,
        text: "Écoutez.",
        section: "listening",
      })
      .returning({ id: questions.id });
    await db
      .insert(audioFiles)
      .values({ questionId: q.id, filePath: "listening/gone.mp3" });
    const res = await app.request(`/api/questions/${String(q.id)}/audio`);
    expect(res.status).toBe(404);
  });

  // spec: docs/specs/server-runtime.md §Behaviour.6 — full body, with Accept-Ranges advertised.
  it("streams the whole file with 200 and Accept-Ranges", async () => {
    const id = await seedAudio(100);
    const res = await app.request(`/api/questions/${String(id)}/audio`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Length")).toBe("100");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("serves a byte window as 206 with Content-Range", async () => {
    const id = await seedAudio(100);
    const res = await app.request(`/api/questions/${String(id)}/audio`, {
      headers: { range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(res.headers.get("Content-Length")).toBe("10");
    expect((await res.arrayBuffer()).byteLength).toBe(10);
  });

  it("answers an unsatisfiable range with 416 and an empty body", async () => {
    const id = await seedAudio(100);
    const res = await app.request(`/api/questions/${String(id)}/audio`, {
      headers: { range: "bytes=500-600" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */100");
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("GET /api/questions/:id/passage-image", () => {
  it("404s a question with no linked passage", async () => {
    const id = await seedReading();
    const res = await app.request(`/api/questions/${String(id)}/passage-image`);
    expect(res.status).toBe(404);
    expect((await json(res)).error?.code).toBe("PASSAGE_IMAGE_NOT_FOUND");
  });

  // Images are loaded whole — the Range header is not honoured for this route.
  it("streams the image whole with 200 and no Accept-Ranges", async () => {
    const id = await seedReading(1, true);
    await media.put("reading/q1.png", new Uint8Array(64), "image/png");
    const res = await app.request(
      `/api/questions/${String(id)}/passage-image`,
      { headers: { range: "bytes=0-9" } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Accept-Ranges")).toBeNull();
    expect((await res.arrayBuffer()).byteLength).toBe(64);
  });

  it("derives image/jpeg from a .jpg passage source file", async () => {
    const [p] = await db
      .insert(passages)
      .values({ sourceFile: "reading/q2.jpg", text: "Texte." })
      .returning({ id: passages.id });
    const [q] = await db
      .insert(questions)
      .values({
        passageId: p.id,
        sourceFile: "reading.pdf",
        sequence: 2,
        text: "Q?",
        section: "reading",
      })
      .returning({ id: questions.id });
    await media.put("reading/q2.jpg", new Uint8Array(8), "image/jpeg");
    const res = await app.request(`/api/questions/${String(q.id)}/passage-image`);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });
});

describe("GET /api/questions/:id/transcript", () => {
  it("404s an unknown question", async () => {
    const res = await app.request("/api/questions/999/transcript");
    expect(res.status).toBe(404);
  });

  it("returns an empty list for a question with no segments", async () => {
    const id = await seedReading();
    const res = await app.request(`/api/questions/${String(id)}/transcript`);
    expect(res.status).toBe(200);
    expect((await json<{ segments: unknown[] }>(res)).data?.segments).toEqual(
      [],
    );
  });

  it("returns the segments ordered by sequence", async () => {
    const id = await seedReading();
    await db.insert(transcriptSegments).values([
      { questionId: id, sequence: 1, text: "deux", startMs: 10, endMs: 20 },
      { questionId: id, sequence: 0, text: "un", startMs: 0, endMs: 10 },
    ]);
    const res = await app.request(`/api/questions/${String(id)}/transcript`);
    const body = await json<{ segments: { text: string }[] }>(res);
    expect(body.data?.segments.map((s) => s.text)).toEqual(["un", "deux"]);
  });
});

describe("writing routes (portable half)", () => {
  async function seedTasks(): Promise<void> {
    await db.insert(writingTasks).values([
      { sourceFile: "t1.md", taskNumber: 1, prompt: "Écrivez un message." },
      { sourceFile: "t2.md", taskNumber: 2, prompt: "Écrivez un article." },
      { sourceFile: "t3.md", taskNumber: 3, prompt: "Argumentez." },
    ]);
  }

  it("rejects an unknown mode", async () => {
    const res = await post("/api/writing/sessions", { mode: "exam" });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("BAD_REQUEST");
  });

  it("rejects non-integer taskNumbers", async () => {
    await seedTasks();
    const res = await post("/api/writing/sessions", {
      mode: "learning",
      taskNumbers: ["1"],
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("taskNumbers");
  });

  it("creates a session and reads it back", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/writing/sessions", { mode: "learning" }),
    );
    const sessionId = created.data!.sessionId;
    const res = await app.request(
      `/api/writing/sessions/${String(sessionId)}`,
    );
    expect(res.status).toBe(200);
    expect((await json(res)).error).toBeNull();
  });

  it("rejects a non-numeric session id on read", async () => {
    const res = await app.request("/api/writing/sessions/oops");
    expect(res.status).toBe(400);
  });

  it("autosaves a draft", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/writing/sessions", { mode: "learning" }),
    );
    const res = await app.request(
      `/api/writing/sessions/${String(created.data!.sessionId)}/responses/1`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Bonjour, je vous écris…" }),
      },
    );
    expect(res.status).toBe(200);
    expect((await json(res)).error).toBeNull();
  });

  it("rejects a draft body with no text", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/writing/sessions", { mode: "learning" }),
    );
    const res = await app.request(
      `/api/writing/sessions/${String(created.data!.sessionId)}/responses/1`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("text");
  });

  it("rejects a task number outside 1–3", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/writing/sessions", { mode: "learning" }),
    );
    const res = await app.request(
      `/api/writing/sessions/${String(created.data!.sessionId)}/responses/9`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x" }),
      },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("taskNumber");
  });
});

describe("speaking routes (portable half)", () => {
  async function seedTasks(): Promise<void> {
    await db.insert(speakingTasks).values([
      { sourceFile: "s.json", sequence: 0, taskNumber: 1, question: "Q1 ?" },
      { sourceFile: "s.json", sequence: 1, taskNumber: 2, question: "Q2 ?" },
      { sourceFile: "s.json", sequence: 2, taskNumber: 3, question: "Q3 ?" },
    ]);
  }

  it("rejects an unknown mode with INVALID_MODE", async () => {
    const res = await post("/api/speaking/sessions", { mode: "exam" });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("INVALID_MODE");
  });

  it("rejects non-integer taskNumbers", async () => {
    await seedTasks();
    const res = await post("/api/speaking/sessions", {
      mode: "learning",
      taskNumbers: [1.5],
    });
    expect(res.status).toBe(400);
  });

  it("creates a session and reads it back", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/speaking/sessions", { mode: "real" }),
    );
    const res = await app.request(
      `/api/speaking/sessions/${String(created.data!.sessionId)}`,
    );
    expect(res.status).toBe(200);
    expect((await json(res)).error).toBeNull();
  });

  it("404s the audio of a task with no recording", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/speaking/sessions", { mode: "learning" }),
    );
    const res = await app.request(
      `/api/speaking/sessions/${String(created.data!.sessionId)}/responses/1/audio`,
    );
    expect(res.status).toBe(404);
  });

  it("streams a saved recording with range support", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/speaking/sessions", { mode: "learning" }),
    );
    const sessionId = created.data!.sessionId;
    await db
      .update(speakingResponses)
      .set({ audioPath: "speaking/take.webm" })
      .where(eq(speakingResponses.sessionId, sessionId));
    await media.put("speaking/take.webm", new Uint8Array(40), "audio/webm");

    const res = await app.request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1/audio`,
      { headers: { range: "bytes=0-9" } },
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-9/40");
  });

  it("rejects a task number outside 1–3 on the audio route", async () => {
    await seedTasks();
    const created = await json<{ sessionId: number }>(
      await post("/api/speaking/sessions", { mode: "learning" }),
    );
    const res = await app.request(
      `/api/speaking/sessions/${String(created.data!.sessionId)}/responses/7/audio`,
    );
    expect(res.status).toBe(400);
  });
});
