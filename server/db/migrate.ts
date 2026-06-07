import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getDatabaseUrl } from '../config/env';

// Applies generated migrations from ./migrations. Run via `npm run db:migrate`.
async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const pool = new pg.Pool({ connectionString: getDatabaseUrl() });
  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: resolve(here, 'migrations') });
  await pool.end();
  console.log('Migrations applied successfully.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
