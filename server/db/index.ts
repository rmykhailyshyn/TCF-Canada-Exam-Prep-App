import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../config/env";
import { ensureSqliteDir } from "./sqlite-path";
import * as schema from "./schema";

// SQLite database (libSQL). spec: docs/specs/database-sqlite.md §Behaviour.1
// libSQL's async API matches Cloudflare D1's, so the Drizzle call sites stay identical between
// local SQLite (here) and D1 (a later milestone). The module-singleton pattern is retained for
// Milestone 13; an injected DB factory replaces it in Milestone 14 (server-runtime.md).
const url = getDatabaseUrl();
// SQLite creates the database file but not its parent directory — make sure it exists first.
ensureSqliteDir(url);

// `foreign_keys` is OFF by default in SQLite; enable it so the schema's references(...) constraints
// are enforced (matching the previous Postgres behaviour). spec: §Data model notes
export const client = createClient({ url });
await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
