import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../db/schema";

// Shared harness for the DB-backed service/route tests. Extracted from the original inline helper in
// server/routes/practice-routes.test.ts so every suite builds its fixture database the same way.
//
// A temp FILE (not a literal ":memory:" URL) is used deliberately: @libsql/client's local sqlite3
// driver lazily reopens a brand-new connection after any `.transaction()` call (see
// node_modules/@libsql/client/lib-esm/sqlite3.js `transaction()` / `#getDb()`) — with a literal
// ":memory:" path that reopen creates a second, empty in-memory database, silently losing the
// migrated schema for every query after the first transaction. A temp file survives reconnects,
// since a fresh connection to the same path sees the same data.

const MIGRATION = fileURLToPath(
  new URL("../db/migrations/0000_living_chimera.sql", import.meta.url),
);

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const openDirs = new Set<string>();

/** A migrated, empty database backed by a fresh temp directory. */
export async function freshDb(): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "tcf-test-"));
  openDirs.add(dir);
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute("PRAGMA foreign_keys = ON");
  const sql = readFileSync(MIGRATION, "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.execute(trimmed);
  }
  return drizzle(client, { schema });
}

/**
 * Best-effort removal of every temp dir handed out by `freshDb`. The native sqlite3 handle can still
 * hold the file open on Windows (EBUSY) briefly after the last query — not a reason to fail a test.
 */
export function cleanupDbs(): void {
  for (const dir of openDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // ignore — OS temp dir, not test-critical
    }
  }
  openDirs.clear();
}
