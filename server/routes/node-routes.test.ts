import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { speakingResponses, speakingTasks, writingTasks } from "../db/schema";
import { nodeCapabilities } from "../runtime/capabilities";
import { createSpeakingSession } from "../services/speaking";
import { createWritingSession } from "../services/writing";
import { type TestDb, cleanupDbs, freshDb } from "../test-support/db";
import { type FakeMediaStore, fakeMediaStore, stubLlm } from "../test-support/fakes";
import type { AppVars } from "./app-vars";
import { registerNodeRoutes } from "./node-routes";

// spec: docs/specs/server-runtime.md §Behaviour.3, 8 (Node-only extension + body limits);
// docs/specs/question-export-import.md, writing-session.md, speaking-session.md §API contract;
// docs/specs/llm-provider.md §Behaviour.1
//
// Drives the CLI-backed routes the Node entry layers on top of the portable core. The two external
// binaries are replaced at the seam: the LLM through an injected stub provider, and Whisper by
// mocking the transcription module (it shells out via child_process and is macOS-only).

const transcribeFile = vi.hoisted(() => vi.fn());

vi.mock("../services/speakingTranscription", async () => {
  const actual = await vi.importActual<
    typeof import("../services/speakingTranscription")
  >("../services/speakingTranscription");
  return { ...actual, transcribeFile };
});

const SCORE_REPLY = JSON.stringify({
  score: 14,
  strengths: "Clear delivery.",
  errors: "A few agreement slips.",
  improvements: "Vary the connectors.",
});
const CORRECTION_REPLY = JSON.stringify({
  correctedText: "Voici la version corrigée.",
  suggestions: ["Accord du participe passé"],
});

let db: TestDb;
let media: FakeMediaStore;

beforeEach(async () => {
  db = await freshDb();
  media = fakeMediaStore();
  transcribeFile.mockReset();
  transcribeFile.mockReturnValue({
    transcript: "Bonjour, je m'appelle Marie.",
    durationMs: 4000,
  });
});

afterEach(() => {
  cleanupDbs();
  vi.unstubAllEnvs();
});

/** The Node app shape: AppVars middleware, then the Node-only routes. `llm` omitted → not configured. */
function makeApp(llm?: ReturnType<typeof stubLlm>): Hono<{ Variables: AppVars }> {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("*", (c, next) => {
    c.set("db", db);
    c.set("mediaStore", media);
    c.set("capabilities", nodeCapabilities);
    c.set("llm", llm);
    return next();
  });
  registerNodeRoutes(app);
  return app;
}

type Envelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

async function json<T>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

// `app.request` is typed `Response | Promise<Response>`; await normalises it for the callers.
async function postJson(
  app: Hono<{ Variables: AppVars }>,
  path: string,
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedWriting(mode: "learning" | "real"): Promise<number> {
  await db.insert(writingTasks).values([
    { sourceFile: "t1.md", taskNumber: 1, prompt: "Écrivez un message." },
    { sourceFile: "t2.md", taskNumber: 2, prompt: "Écrivez un article." },
    { sourceFile: "t3.md", taskNumber: 3, prompt: "Argumentez." },
  ]);
  const { sessionId } = await createWritingSession(db, { mode });
  return sessionId;
}

async function seedSpeaking(mode: "learning" | "real"): Promise<number> {
  await db.insert(speakingTasks).values([
    { sourceFile: "s.json", sequence: 0, taskNumber: 1, question: "Q1 ?" },
    { sourceFile: "s.json", sequence: 1, taskNumber: 2, question: "Q2 ?" },
    { sourceFile: "s.json", sequence: 2, taskNumber: 3, question: "Q3 ?" },
  ]);
  const { sessionId } = await createSpeakingSession(db, { mode });
  return sessionId;
}

/** An `audio` multipart upload for the recording route. */
function audioForm(bytes: number, type = "audio/webm"): FormData {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type }), "take.webm");
  return form;
}

describe("POST /api/questions/import", () => {
  const DOC = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    filter: { section: "all", difficulties: "all" },
    questions: [
      {
        section: "reading",
        sourceFile: "reading.pdf",
        sequence: 1,
        difficulty: "beginner",
        text: "Quel est le sujet ?",
        options: (["A", "B", "C", "D"] as const).map((label) => ({
          label,
          text: `Option ${label}`,
          isCorrect: label === "A",
        })),
        passage: { sourceFile: "p.txt", text: "Le texte." },
        audio: null,
        transcript: [],
      },
    ],
  };

  it("imports a document and returns the summary", async () => {
    const res = await postJson(makeApp(), "/api/questions/import", {
      document: DOC,
    });
    expect(res.status).toBe(200);
    expect((await json(res)).data).toMatchObject({ inserted: 1, total: 1 });
  });

  it("defaults override to false, skipping an existing question", async () => {
    const app = makeApp();
    await postJson(app, "/api/questions/import", { document: DOC });
    const res = await postJson(app, "/api/questions/import", {
      document: DOC,
      override: "yes",
    });
    expect((await json(res)).data).toMatchObject({ skipped: 1, overridden: 0 });
  });

  it("honours override: true", async () => {
    const app = makeApp();
    await postJson(app, "/api/questions/import", { document: DOC });
    const res = await postJson(app, "/api/questions/import", {
      document: DOC,
      override: true,
    });
    expect((await json(res)).data).toMatchObject({ overridden: 1 });
  });

  it("maps a validation failure onto its envelope", async () => {
    const res = await postJson(makeApp(), "/api/questions/import", {
      document: { ...DOC, formatVersion: 42 },
    });
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("INVALID_FORMAT");
  });
});

describe("writing submit / correct / complete", () => {
  // spec: docs/specs/llm-provider.md §Behaviour.1 — the Node entry always injects a provider; its
  // absence is a wiring bug, surfaced as an opaque 500.
  it("500s when no LLM provider is configured", async () => {
    const sessionId = await seedWriting("learning");
    const res = await postJson(
      makeApp(),
      `/api/writing/sessions/${String(sessionId)}/responses/1/submit`,
      { text: "Bonjour, je vous écris au sujet de …" },
    );
    expect(res.status).toBe(500);
    expect((await json(res)).error?.code).toBe("INTERNAL");
  });

  it("scores a submitted response", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedWriting("learning");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/responses/1/submit`,
      { text: "Bonjour, je vous écris au sujet de la réunion de demain." },
    );
    expect(res.status).toBe(200);
    const body = await json<{ score: number; level: string }>(res);
    expect(body.data?.score).toBe(14);
    // NCLC is derived from the score by server/lib/nclc.ts, never produced by the model.
    expect(body.data?.level).toMatch(/^NCLC /);
  });

  it("rejects a submit body with no text", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedWriting("learning");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/responses/1/submit`,
      {},
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("text");
  });

  it("rejects a task number outside 1–3", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedWriting("learning");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/responses/8/submit`,
      { text: "x" },
    );
    expect(res.status).toBe(400);
  });

  it("returns a correction in training mode", async () => {
    const app = makeApp(stubLlm(CORRECTION_REPLY));
    const sessionId = await seedWriting("learning");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/correct/1`,
      { text: "Je suis aller au marché." },
    );
    expect(res.status).toBe(200);
    expect((await json<{ correctedText: string }>(res)).data?.correctedText)
      .toBeTruthy();
  });

  it("refuses a correction in real mode", async () => {
    const app = makeApp(stubLlm(CORRECTION_REPLY));
    const sessionId = await seedWriting("real");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/correct/1`,
      { text: "Je suis aller au marché." },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("MODE_NOT_ALLOWED");
  });

  it("completes a session and aggregates the tasks", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedWriting("learning");
    await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/responses/1/submit`,
      { text: "Une réponse suffisamment longue pour être évaluée." },
    );
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/complete`,
      { elapsedMs: 60_000 },
    );
    expect(res.status).toBe(200);
    const body = await json<{ tasks: unknown[]; submitted: number }>(res);
    expect(body.data?.tasks).toHaveLength(3);
    expect(body.data?.submitted).toBe(1);
  });

  it("treats a non-integer elapsedMs on complete as absent", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedWriting("real");
    const res = await postJson(
      app,
      `/api/writing/sessions/${String(sessionId)}/complete`,
      { elapsedMs: "later" },
    );
    expect(res.status).toBe(200);
  });
});

describe("speaking recording upload", () => {
  it("rejects a request with no audio part", async () => {
    const sessionId = await seedSpeaking("learning");
    const res = await makeApp().request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1`,
      { method: "POST", body: new FormData() },
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.message).toContain("audio");
  });

  it("rejects an empty audio part", async () => {
    const sessionId = await seedSpeaking("learning");
    const res = await makeApp().request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1`,
      { method: "POST", body: audioForm(0) },
    );
    expect(res.status).toBe(400);
  });

  // spec: docs/specs/speaking-evaluation.md §Behaviour.2–4 — store the audio, then transcribe it.
  it("stores the recording and returns the Whisper transcript", async () => {
    const sessionId = await seedSpeaking("learning");
    const res = await makeApp().request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1`,
      { method: "POST", body: audioForm(32) },
    );
    expect(res.status).toBe(200);
    const body = await json<{ transcript: string; durationMs: number }>(res);
    expect(body.data?.transcript).toBe("Bonjour, je m'appelle Marie.");
    expect(body.data?.durationMs).toBe(4000);
    expect(media.keys()).toHaveLength(1);
    expect(transcribeFile).toHaveBeenCalledTimes(1);

    const [row] = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    expect(row.transcript).toBe("Bonjour, je m'appelle Marie.");
  });

  // spec: docs/specs/speaking-evaluation.md §Behaviour.5 — keep the audio for a retry on failure.
  it("returns 502 but keeps the stored audio when Whisper fails", async () => {
    const { WhisperError } = await import("../services/speakingTranscription");
    transcribeFile.mockImplementation(() => {
      throw new WhisperError("whisper binary not found");
    });
    const sessionId = await seedSpeaking("learning");
    const res = await makeApp().request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1`,
      { method: "POST", body: audioForm(16) },
    );
    expect(res.status).toBe(502);
    expect((await json(res)).error?.code).toBe("TRANSCRIPTION_FAILED");
    expect(media.keys()).toHaveLength(1);

    const [row] = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    expect(row.audioPath).not.toBeNull();
    expect(row.transcript).toBeNull();
  });

  it("rejects a task number outside 1–3", async () => {
    const sessionId = await seedSpeaking("learning");
    const res = await makeApp().request(
      `/api/speaking/sessions/${String(sessionId)}/responses/4`,
      { method: "POST", body: audioForm(8) },
    );
    expect(res.status).toBe(400);
  });
});

describe("speaking submit / correct / complete", () => {
  async function withRecording(
    mode: "learning" | "real",
    llm = stubLlm(SCORE_REPLY),
  ): Promise<{ app: Hono<{ Variables: AppVars }>; sessionId: number }> {
    const app = makeApp(llm);
    const sessionId = await seedSpeaking(mode);
    await app.request(
      `/api/speaking/sessions/${String(sessionId)}/responses/1`,
      { method: "POST", body: audioForm(24) },
    );
    return { app, sessionId };
  }

  it("500s when no LLM provider is configured", async () => {
    const sessionId = await seedSpeaking("learning");
    const res = await postJson(
      makeApp(),
      `/api/speaking/sessions/${String(sessionId)}/responses/1/submit`,
    );
    expect(res.status).toBe(500);
  });

  it("refuses to submit a task with no recording", async () => {
    const app = makeApp(stubLlm(SCORE_REPLY));
    const sessionId = await seedSpeaking("learning");
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/responses/2/submit`,
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("NO_RECORDING");
  });

  // spec: docs/specs/speaking-evaluation.md §Behaviour.6–8 — score the stored transcript.
  it("scores a recorded task", async () => {
    const { app, sessionId } = await withRecording("learning");
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/responses/1/submit`,
    );
    expect(res.status).toBe(200);
    const body = await json<{ score: number; level: string }>(res);
    expect(body.data?.score).toBe(14);
    // NCLC is derived from the score by server/lib/nclc.ts, never produced by the model.
    expect(body.data?.level).toMatch(/^NCLC /);
  });

  it("returns 502 when the model reply cannot be parsed", async () => {
    const { app, sessionId } = await withRecording(
      "learning",
      stubLlm("not json at all"),
    );
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/responses/1/submit`,
    );
    expect(res.status).toBe(502);
    expect((await json(res)).error?.code).toBe("EVALUATION_FAILED");
  });

  it("returns a correction in training mode", async () => {
    const { app, sessionId } = await withRecording(
      "learning",
      stubLlm(CORRECTION_REPLY),
    );
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/correct/1`,
    );
    expect(res.status).toBe(200);
    expect(
      (await json<{ correctedText: string }>(res)).data?.correctedText,
    ).toBeTruthy();
  });

  it("refuses a correction in real mode", async () => {
    const { app, sessionId } = await withRecording(
      "real",
      stubLlm(CORRECTION_REPLY),
    );
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/correct/1`,
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("MODE_NOT_ALLOWED");
  });

  it("refuses a correction for a task with no recording", async () => {
    const app = makeApp(stubLlm(CORRECTION_REPLY));
    const sessionId = await seedSpeaking("learning");
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/correct/3`,
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe("NO_RECORDING");
  });

  // spec: docs/specs/speaking-session.md §Behaviour.14 — real mode scores any recorded, unscored task.
  it("scores outstanding recorded tasks when a real session completes", async () => {
    const { app, sessionId } = await withRecording("real");
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/complete`,
      { elapsedMs: 300_000 },
    );
    expect(res.status).toBe(200);
    const body = await json<{
      tasks: { score: number | null }[];
      submitted: number;
      overallScore: number;
    }>(res);
    expect(body.data?.submitted).toBe(1);
    expect(body.data?.tasks).toHaveLength(3);
    // spec: §Behaviour.17a — unscored tasks count as 0 in the mean: round(14/3) = 5.
    expect(body.data?.overallScore).toBe(5);
  });

  // spec: §Behaviour.14 — a model failure leaves that task unscored rather than failing the request.
  it("still completes when scoring an outstanding task fails", async () => {
    const { app, sessionId } = await withRecording(
      "real",
      stubLlm("unparseable"),
    );
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/complete`,
      {},
    );
    expect(res.status).toBe(200);
    const body = await json<{ submitted: number; overallScore: number }>(res);
    expect(body.data?.submitted).toBe(0);
    expect(body.data?.overallScore).toBe(0);
  });

  // A finalised session is not re-scored; the persisted aggregate is just re-reported.
  it("is idempotent on a second complete call", async () => {
    const { app, sessionId } = await withRecording("real");
    const first = await json<{ overallScore: number }>(
      await postJson(
        app,
        `/api/speaking/sessions/${String(sessionId)}/complete`,
        { elapsedMs: 1000 },
      ),
    );
    const second = await json<{ overallScore: number }>(
      await postJson(
        app,
        `/api/speaking/sessions/${String(sessionId)}/complete`,
        { elapsedMs: 9999 },
      ),
    );
    expect(second.data?.overallScore).toBe(first.data?.overallScore);
  });

  it("does not auto-score outstanding tasks for a training session", async () => {
    const { app, sessionId } = await withRecording("learning");
    const res = await postJson(
      app,
      `/api/speaking/sessions/${String(sessionId)}/complete`,
      {},
    );
    const body = await json<{ submitted: number }>(res);
    expect(body.data?.submitted).toBe(0);
  });
});
