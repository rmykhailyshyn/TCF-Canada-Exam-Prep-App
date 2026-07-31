import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import { vi } from "vitest";
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
// Shared harness for the practice-route suites (practice-routes.writing.test.ts /
// practice-routes.speaking.test.ts). The Worker entry binds these handlers to D1 + R2; here we drive
// the SAME handlers against a temp-file-backed libSQL DB and a fake in-memory MediaStore injected
// through the AppVars middleware (the identical context contract the Worker root middleware provides).
//
// A temp FILE (not a literal ":memory:" URL) is used deliberately: @libsql/client's local sqlite3
// driver lazily reopens a brand-new connection after any `.transaction()` call (see
// node_modules/@libsql/client/lib-esm/sqlite3.js `transaction()` / `#getDb()`) — with a literal
// ":memory:" path that reopen creates a second, empty in-memory database, silently losing the
// migrated schema for every query after the first transaction. The scoring tests exercise
// writing-scoring.ts's `db.transaction()` (persistEvaluation), so they need the schema to survive
// reconnects — a temp file does, since a fresh connection to the same path sees the same data.

const MIGRATION = fileURLToPath(
  new URL("../db/migrations/0000_living_chimera.sql", import.meta.url),
);

export type Db = ReturnType<typeof drizzle<typeof schema>>;
export type FakeMediaStore = MediaStore & { keys: () => string[] };
export type Llm = { provider: LlmProvider; config: LlmConfig };

export type Harness = {
  db: Db;
  media: FakeMediaStore;
  // A Hono app mounting the practice routes behind the same AppVars injection the Worker uses.
  // `llm` mirrors what server/worker.ts sets only when ANTHROPIC_API_KEY is bound (llm-provider.md
  // §Behaviour.8); omitting it (the default) reproduces the pre-M17 practice-only behaviour.
  makeApp: (llm?: Llm) => Hono<{ Variables: AppVars }>;
  seedWritingSession: (mode: "learning" | "real") => Promise<number>;
  seedSpeakingSession: (mode: "learning" | "real") => Promise<number>;
  cleanup: () => void;
};

async function freshDb(dir: string): Promise<Db> {
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute("PRAGMA foreign_keys = ON");
  const sql = readFileSync(MIGRATION, "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.execute(trimmed);
  }
  return drizzle(client, { schema });
}

// Minimal in-memory MediaStore so storeRecording can put/stat without a filesystem.
function fakeMediaStore(): FakeMediaStore {
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

export async function createHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "tcf-practice-routes-"));
  const db = await freshDb(dir);
  const media = fakeMediaStore();

  return {
    db,
    media,
    makeApp(llm?: Llm) {
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
    },
    async seedWritingSession(mode) {
      await db.insert(writingTasks).values([
        { sourceFile: "t1.md", taskNumber: 1, prompt: "Write task 1." },
        { sourceFile: "t2.md", taskNumber: 2, prompt: "Write task 2." },
        { sourceFile: "t3.md", taskNumber: 3, prompt: "Write task 3." },
      ]);
      const { sessionId } = await createWritingSession(db, { mode });
      return sessionId;
    },
    async seedSpeakingSession(mode) {
      await db.insert(speakingTasks).values([
        { sourceFile: "s.json", sequence: 0, taskNumber: 1, question: "Q1?" },
        { sourceFile: "s.json", sequence: 1, taskNumber: 2, question: "Q2?" },
        { sourceFile: "s.json", sequence: 2, taskNumber: 3, question: "Q3?" },
      ]);
      const { sessionId } = await createSpeakingSession(db, { mode });
      return sessionId;
    },
    cleanup() {
      // Best-effort cleanup: the native sqlite3 handle can still hold the file open on Windows
      // (EBUSY) briefly after the test's last query — that's not a reason to fail the test.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // ignore — OS temp dir, not test-critical
      }
    },
  };
}

// spec: docs/specs/llm-provider.md §Behaviour.4, 6 — a stub LlmProvider (no real fetch) that always
// resolves the fixed JSON reply, so the scoring-enabled tests exercise the real writing-scoring.ts
// service and its `completeJson` retry wrapper without any network dependency.
export function stubLlm(reply: string): Llm {
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
