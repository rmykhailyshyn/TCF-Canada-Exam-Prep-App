import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDatabaseUrl } from "../config/env";
import { ensureSqliteDir } from "./sqlite-path";

// Applies generated migrations from ./migrations. Run via `npm run db:migrate`.
// spec: docs/specs/database-sqlite.md §Behaviour.1
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const url = getDatabaseUrl();
  ensureSqliteDir(url);
  const client = createClient({ url });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: resolve(here, "migrations") });
  client.close();
  console.log("Migrations applied successfully.");
}

main().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
