import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { getDatabaseUrl } from "../config/env";
import { ensureSqliteDir } from "./sqlite-path";
import * as schema from "./schema";

// SQLite database (libSQL) singleton. spec: docs/specs/database-sqlite.md §Behaviour.1
// As of Milestone 14 (server-runtime.md) the request-serving code obtains its DB from the injected
// factory (server/db/factory.ts); this module-level singleton is retained ONLY for the Node-only
// CLI tooling in scripts/ (seed, ocr, transcribe, enrich, import-*, migrate-media), which run
// outside the request lifecycle and do not use the service layer.
const url = getDatabaseUrl();
// SQLite creates the database file but not its parent directory — make sure it exists first.
ensureSqliteDir(url);

// `foreign_keys` is OFF by default in SQLite; enable it so the schema's references(...) constraints
// are enforced. spec: §Data model notes
export const client = createClient({ url });
// eslint-disable-next-line invariants/no-raw-sql -- static PRAGMA on the raw libSQL client (no user input); Drizzle's query builder cannot issue connection PRAGMAs.
await client.execute("PRAGMA foreign_keys = ON");

export const db = drizzle(client, { schema });
