import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { getDatabaseUrl } from "../config/env";
import { ensureSqliteDir } from "./sqlite-path";
import * as schema from "./schema";

// spec: docs/specs/server-runtime.md §Behaviour.5; §Runtime abstractions (DB factory)
// docs/specs/cloud-deployment.md §Data model changes (Rule 4: DbClient widened for D1)
// The Drizzle DB is built from the runtime's binding rather than imported as a module singleton, so
// the same service code runs on Node (libSQL file, here) and on a Cloudflare Worker (D1, per request
// — Milestone 15). Services receive `DbClient` as a parameter; routes pass `c.get('db')`.
//
// `DbClient` is the shared SQLite Drizzle base type so BOTH the libSQL client (here) and the D1
// client (`drizzle-orm/d1` in server/worker.ts) satisfy it — their query APIs are identical; only the
// run-result generic differs (libSQL ResultSet vs D1Result), hence `any` there.
export type DbClient = BaseSQLiteDatabase<
  "async",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- run-result type is driver-specific (libSQL vs D1); the schema-typed query API is identical
  any,
  typeof schema
>;

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
