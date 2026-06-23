import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// SQLite/libSQL opens the database file but does not create its parent directory; a fresh checkout
// with the default `file:./data/tcf_prep.db` would otherwise fail. Ensure the directory exists for
// any local `file:` URL (in-memory and remote libSQL URLs are left untouched).
// spec: docs/specs/database-sqlite.md §Behaviour.1
export function ensureSqliteDir(url: string): void {
  if (!url.startsWith('file:')) return;
  // Strip the `file:` scheme; keep the path as-is (relative paths resolve against the cwd).
  const path = url.slice('file:'.length);
  if (!path || path === ':memory:') return;
  const dir = dirname(path);
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true });
  }
}
