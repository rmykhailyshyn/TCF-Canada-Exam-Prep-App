import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';

// Load environment variables from the repo-root .env before anything reads them.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
loadDotenv({ path: resolve(repoRoot, '.env') });

// libSQL/SQLite connection URL (a `file:` path locally). Defaults to a repo-local SQLite file so a
// fresh checkout works with no setup — no Docker, no Postgres. spec: docs/specs/database-sqlite.md
const DEFAULT_DATABASE_URL = 'file:./data/tcf_prep.db';

// libSQL resolves a relative `file:` path against process.cwd(), which differs between the server
// workspace (server/) and the root-run tooling (migrate/seed/e2e) — they would otherwise open
// different database files. Anchor any relative `file:` path to the repo root so every entry point
// agrees on one database regardless of cwd. Non-file URLs (and :memory:) are returned untouched.
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  if (!url.startsWith('file:')) return url;
  const path = url.slice('file:'.length);
  if (!path || path === ':memory:' || isAbsolute(path)) return url;
  return `file:${resolve(repoRoot, path)}`;
}

export function getPort(): number {
  return Number(process.env.PORT ?? 3001);
}

// spec: docs/specs/question-export-import.md §Export document format
// Directory that listening audio basenames resolve against on import. The export carries the
// MP3 basename only (never the bytes); import joins it onto this directory to form the stored
// file_path. Defaults to `<repo-root>/media` when MEDIA_DIR is unset.
export function getMediaDir(): string {
  const fromEnv = process.env.MEDIA_DIR;
  if (fromEnv) return resolve(fromEnv);
  return resolve(here, '../../media');
}
