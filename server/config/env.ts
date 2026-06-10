import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load environment variables from the repo-root .env before anything reads them.
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, '../../.env') });

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }
  return url;
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
