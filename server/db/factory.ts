import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getDatabaseUrl } from "../config/env";
import { ensureSqliteDir } from "./sqlite-path";
import * as schema from "./schema";

// spec: docs/specs/server-runtime.md §Behaviour.5; §Runtime abstractions (DB factory)
// The Drizzle DB is built from the runtime's binding rather than imported as a module singleton, so
// the same service code runs on Node (libSQL file, here) and, later, on a Cloudflare Worker (D1, per
// request — Milestone 15). Services receive `DbClient` as a parameter; routes pass `c.get('db')`.

export type DbClient = LibSQLDatabase<typeof schema>;

// spec: docs/specs/server-runtime.md §Behaviour.5 — construct the libSQL Drizzle client once on Node.
export async function createDb(): Promise<DbClient> {
  const url = getDatabaseUrl();
  // SQLite creates the database file but not its parent directory — make sure it exists first.
  ensureSqliteDir(url);
  const client = createClient({ url });
  // `foreign_keys` is OFF by default in SQLite; enable it so the schema's references(...) constraints
  // are enforced.
  await client.execute("PRAGMA foreign_keys = ON");
  return drizzle(client, { schema });
}
