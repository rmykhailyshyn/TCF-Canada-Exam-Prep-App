import { defineConfig } from 'drizzle-kit';

// Drizzle Kit configuration: schema is the single source of truth in server/db/schema.ts;
// generated migrations land in server/db/migrations.
export default defineConfig({
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/tcf_prep',
  },
  verbose: true,
  strict: true,
});
