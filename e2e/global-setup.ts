import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import pg from 'pg';

// Playwright global setup. Makes the run self-contained AND deterministic by isolating it onto a
// DEDICATED e2e database, so the suite never depends on (or mutates) the dev DB — which may hold
// real imported exams with several questions per position. We (1) ensure the generated listening
// dev audio exists, (2) create + migrate the e2e DB, and (3) seed reading + listening dev data.
// The dev server is launched against this same DB via playwright.config.ts `webServer.env`.

const ROOT = process.cwd();
const AUDIO_DIR = resolve(ROOT, 'scripts/dev-audio');

loadDotenv({ path: resolve(ROOT, '.env') });

// The e2e DB URL, derived from DATABASE_URL by swapping the database name to `tcf_prep_e2e`.
// Exported so playwright.config.ts can point the app's webServer at the same database.
export const E2E_DATABASE_URL = deriveE2eDatabaseUrl();

function deriveE2eDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env before running e2e.');
  }
  const url = new URL(base);
  url.pathname = '/tcf_prep_e2e';
  return url.toString();
}

function run(label: string, cmd: string, args: string[], env: Record<string, string> = {}): void {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    throw new Error(`Global setup step "${label}" failed (${cmd} ${args.join(' ')}).`);
  }
}

// Creates the e2e database if it doesn't exist yet (connecting to the `postgres` maintenance DB).
async function ensureE2eDatabase(): Promise<void> {
  const target = new URL(E2E_DATABASE_URL);
  const dbName = target.pathname.slice(1);
  const admin = new URL(E2E_DATABASE_URL);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      // dbName is a fixed literal (not user input); safe to interpolate for CREATE DATABASE.
      await client.query(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await client.end();
  }
}

export default async function globalSetup(): Promise<void> {
  // 1. Ensure the four listening dev clips exist (real, playable MP3s). Generate any missing ones
  //    with ffmpeg — distinct sine tones, 6s each, matching the durations the listening seed uses.
  for (let i = 1; i <= 4; i += 1) {
    const file = resolve(AUDIO_DIR, `listening-dev-q${String(i).padStart(2, '0')}.mp3`);
    if (existsSync(file)) continue;
    const result = spawnSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 120}:duration=6`, '-ac', '1', '-ar', '22050', '-b:a', '64k', file],
      { stdio: 'ignore' },
    );
    if (result.status !== 0) {
      throw new Error(
        `Missing ${file} and ffmpeg could not generate it. Install ffmpeg (brew install ffmpeg) ` +
          `or create the dev clips manually before running the e2e suite.`,
      );
    }
  }

  // 2. Create + migrate the dedicated e2e database, then seed it. All steps run against
  //    E2E_DATABASE_URL (dotenv does not override an already-set DATABASE_URL, so the override holds).
  await ensureE2eDatabase();
  const env = { DATABASE_URL: E2E_DATABASE_URL };
  run('migrate e2e db', 'npx', ['tsx', 'server/db/migrate.ts'], env);
  run('seed reading', 'npx', ['tsx', 'scripts/seed-dev.ts'], env);
  run('seed listening', 'npx', ['tsx', 'scripts/seed-listening-dev.ts'], env);
}
