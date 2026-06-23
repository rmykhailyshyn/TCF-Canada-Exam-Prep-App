import { defineConfig } from 'drizzle-kit';

// Drizzle Kit configuration: schema is the single source of truth in server/db/schema.ts;
// generated migrations land in server/db/migrations. SQLite/libSQL dialect — see
// docs/specs/database-sqlite.md.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/tcf_prep.db',
  },
  verbose: true,
  strict: true,
});
