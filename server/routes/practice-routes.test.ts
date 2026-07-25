import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import { speakingTasks, writingTasks } from "../db/schema";
import type { LlmConfig, LlmProvider } from "../lib/llm-provider";
import { workerCapabilities } from "../runtime/capabilities";
import type { MediaStore } from "../runtime/media-store";
import { createWritingSession } from "../services/writing";
import { createSpeakingSession } from "../services/speaking";
import type { AppVars } from "./app-vars";
import { registerPracticeRoutes } from "./practice-routes";

// spec: docs/specs/content-deploy.md §Behaviour.4, 5, 7; §Scope (online practice-only behaviour)
// DB-backed coverage for the Worker's practice-only route extension. The Worker entry binds these
// handlers to D1 + R2; here we drive the SAME handlers against a temp-file-backed libSQL DB and a
// fake in-memory MediaStore injected through the AppVars middleware (the identical context contract
// the Worker root middleware provides). This exercises lockResponse / storeRecording /
// complete*SessionUnscored end-to-end and asserts the practice-only contract: writing submit locks
// without an evaluation (score: null), recording upload stores audio and returns an empty transcript,
// and both completes report a null overall score because no task is ever scored online.
//
// A temp FILE (not a literal ":memory:" URL) is used deliberately: @libsql/client's local sqlite3
// driver lazily reopens a brand-new connection after any `.transaction()` call (see
// node_modules/@libsql/client/lib-esm/sqlite3.js `transaction()` / `#getDb()`) — with a literal
// ":memory:" path that reopen creates a second, empty in-memory database, silently losing the
// migrated schema for every query after the first transaction. The scoring tests below exercise
// writing-scoring.ts's `db.transaction()` (persistEvaluation), so they need the schema to survive
// reconnects — a temp file does, since a fresh connection to the same path sees the same data.

const MIGRATION = fileURLToPath(
  new URL("../db/migrations/0000_living_chimera.sql", import.meta.url),
);

type Db = ReturnType<typeof drizzle<typeof schema>>;

let dbDir: string | null = null;

async function freshDb(): Promise<Db> {
  dbDir = mkdtempSync(join(tmpdir(), "tcf-practice-routes-"));
  const client = createClient({ url: `file:${join(dbDir, "test.db")}` });
  await client.execute("PRAGMA foreign_keys = ON");
  const sql = readFileSync(MIGRATION, "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.execute(trimmed);
  }
  return drizzle(client, { schema });
}

// Minimal in-memory MediaStore so storeRecording can put/stat without a filesystem.
function fakeMediaStore(): MediaStore & { keys: () => string[] } {
  const store = new Map<string, Uint8Array>();
  return {
    keys: () => [...store.keys()],
    async stat(key) {
      const v = store.get(key);
      return v
        ? { size: v.byteLength, contentType: "application/octet-stream" }
        : null;
    },
    async getRange(key) {
      const v = store.get(key) ?? new Uint8Array();
      return new ReadableStream({
        start(controller) {
          controller.enqueue(v);
          controller.close();
        },
      });
    },
    async put(key, bytes) {
      store.set(key, bytes);
    },
    async exists(key) {
      return store.has(key);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

let db: Db;
let media: ReturnType<typeof fakeMediaStore>;

// A Hono app that mounts the practice routes behind the same AppVars injection the Worker uses.
// `llm` mirrors what server/worker.ts sets only when ANTHROPIC_API_KEY is bound (llm-provider.md
// §Behaviour.8); omitting it (the default) reproduces every pre-M17 test in this file unchanged.
function makeApp(llm?: {
  provider: LlmProvider;
  config: LlmConfig;
}): Hono<{ Variables: AppVars }> {
  const app = new Hono<{ Variables: AppVars }>();
  app.use("*", (c, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- libSQL drizzle satisfies the DbClient query API used by the services (driver run-result differs from D1, like the worker entry)
    c.set("db", db as any);
    c.set("mediaStore", media);
    c.set(
      "capabilities",
      llm ? { ...workerCapabilities, aiScoring: true } : workerCapabilities,
    );
    c.set("llm", llm);
    return next();
  });
  registerPracticeRoutes(app);
  return app;
}

// spec: docs/specs/llm-provider.md §Behaviour.4, 6 — a stub LlmProvider (no real fetch) that always
// resolves the fixed JSON reply, so the scoring-enabled tests exercise the real writing-scoring.ts
// service and its `completeJson` retry wrapper without any network dependency.
function stubLlm(reply: string): { provider: LlmProvider; config: LlmConfig } {
  const config: LlmConfig = {
    provider: "api",
    apiKey: "sk-ant-test",
    model: "claude-opus-4-8",
    baseUrl: "https://api.anthropic.com",
    maxTokens: 4096,
  };
  const provider: LlmProvider = { complete: vi.fn().mockResolvedValue(reply) };
  return { provider, config };
}

async function seedWritingSession(mode: "learning" | "real"): Promise<number> {
  await db.insert(writingTasks).values([
    { sourceFile: "t1.md", taskNumber: 1, prompt: "Write task 1." },
    { sourceFile: "t2.md", taskNumber: 2, prompt: "Write task 2." },
    { sourceFile: "t3.md", taskNumber: 3, prompt: "Write task 3." },
  ]);
  const { sessionId } = await createWritingSession(db, { mode });
  return sessionId;
}

async function seedSpeakingSession(mode: "learning" | "real"): Promise<number> {
  await db.insert(speakingTasks).values([
    { sourceFile: "s.json", sequence: 0, taskNumber: 1, question: "Q1?" },
    { sourceFile: "s.json", sequence: 1, taskNumber: 2, question: "Q2?" },
    { sourceFile: "s.json", sequence: 2, taskNumber: 3, question: "Q3?" },
  ]);
  const { sessionId } = await createSpeakingSession(db, { mode });
  return sessionId;
}

beforeEach(async () => {
  db = await freshDb();
  media = fakeMediaStore();
});

afterEach(() => {
  // Best-effort cleanup: the native sqlite3 handle can still hold the file open on Windows
  // (EBUSY) briefly after the test's last query — that's not a reason to fail the test.
  try {
    if (dbDir) rmSync(dbDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // ignore — OS temp dir, not test-critical
  }
  dbDir = null;
});

describe("practice routes (Worker practice-only) — writing", () => {
  it("submit locks the draft and returns score: null with no evaluation", async () => {
    const app = makeApp();
    const sessionId = await seedWritingSession("learning");

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
    const rows = await db.query.writingResponses.findMany();
    const task1 = rows.find((r) => r.taskNumber === 1);
    expect(task1?.submittedAt).not.toBeNull();
    expect(task1?.responseText).toBe("Bonjour le monde encore");
    // No evaluation row was ever created online.
    const evals = await db.query.writingEvaluations.findMany();
    expect(evals).toHaveLength(0);
  });

  it("complete finalises the session unscored (overallScore: null, submitted: 0)", async () => {
    const app = makeApp();
    const sessionId = await seedWritingSession("real");

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
    const sessionRows = await db.query.sessions.findMany();
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
    const app = makeApp(stubLlm(scoreReply));
    const sessionId = await seedWritingSession("learning");

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

    const evals = await db.query.writingEvaluations.findMany();
    expect(evals).toHaveLength(1);
    expect(evals[0]?.generatedBy).toBe("claude-api/claude-opus-4-8");
  });

  it("correct produces a correction (training only) instead of 404", async () => {
    const app = makeApp(stubLlm(correctionReply));
    const sessionId = await seedWritingSession("learning");

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
    const app = makeApp(stubLlm(scoreReply));
    const sessionId = await seedWritingSession("real");

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

describe("practice routes (Worker practice-only) — speaking", () => {
  it("recording upload stores audio and returns an empty transcript", async () => {
    const app = makeApp();
    const sessionId = await seedSpeakingSession("learning");

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
    expect(media.keys()).toContain(`speaking/session-${sessionId}-task-1.webm`);
    const rows = await db.query.speakingResponses.findMany();
    const task1 = rows.find((r) => r.taskNumber === 1);
    expect(task1?.audioPath).toBe(`speaking/session-${sessionId}-task-1.webm`);
    expect(task1?.transcript).toBeNull();
  });

  it("complete finalises the session unscored (overallScore: null, submitted: 0)", async () => {
    const app = makeApp();
    const sessionId = await seedSpeakingSession("real");

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

    const sessionRows = await db.query.sessions.findMany();
    expect(sessionRows[0]?.completedAt).not.toBeNull();
  });
});
