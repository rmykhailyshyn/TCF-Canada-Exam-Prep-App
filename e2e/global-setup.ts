import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Playwright global setup. Makes the run self-contained AND deterministic by isolating it onto a
// DEDICATED e2e database FILE, so the suite never depends on (or mutates) the dev DB — which may hold
// real imported exams with several questions per position. We (1) ensure the generated listening
// dev audio exists, (2) migrate the run's own e2e SQLite file, and (3) seed reading +
// listening dev data. The dev server is launched against this same DB via playwright.config.ts
// `webServer.env`. SQLite is a single file: no Docker, no database server, runs on Windows + macOS.
// spec: docs/specs/database-sqlite.md §Behaviour.5

const ROOT = process.cwd();
const AUDIO_DIR = resolve(ROOT, "scripts/dev-audio");

loadDotenv({ path: resolve(ROOT, ".env") });

// Per-run id, memoised in the ENVIRONMENT rather than in module scope: Playwright loads this module
// once in the runner and again in every test worker and in the webServer child, and all of them must
// agree on one filename. Children inherit the variable the runner sets, so the id is stable per
// `playwright test` invocation and different between invocations.
process.env.E2E_DB_ID ??= `${Date.now().toString(36)}-${process.pid.toString(36)}`;

// The e2e DB URL, derived from DATABASE_URL by swapping the SQLite filename to a run-scoped
// `tcf_prep_e2e-<id>.db`. Exported so playwright.config.ts can point the app's webServer at the
// same database.
//
// The filename is per-run because Playwright starts `webServer` BEFORE globalSetup: the dev server
// has usually already opened (and thereby created) this file by the time we get here. Deleting a
// fixed-name file at this point would leave the running server holding a now-unlinked, table-less
// inode for the rest of the run — every /api request then fails, which is exactly how this suite
// broke in CI while passing locally (a pure timing race). With a fresh name per run there is nothing
// stale to delete: whichever side creates the file first, `migrate` applies the schema to the SAME
// inode the server has open, and previous runs' files are cleaned up separately.
export const E2E_DATABASE_URL = deriveE2eDatabaseUrl();

// Prefix (without the run id) shared by every e2e database file, used to spot stale ones.
const E2E_DB_PREFIX = "tcf_prep_e2e-";

function deriveE2eDatabaseUrl(): string {
  // Mirror the app's default (server/config/env.ts) so e2e works with no .env present.
  const base = process.env.DATABASE_URL ?? "file:./data/tcf_prep.db";
  if (!base.startsWith("file:")) {
    throw new Error(
      `DATABASE_URL must be a SQLite file: URL for the e2e suite (got "${base}"). ` +
        "Copy .env.example to .env.",
    );
  }
  // Swap the final path segment for the dedicated e2e filename (keep the same directory).
  return base.replace(/[^/\\]+$/, `tcf_prep_e2e-${process.env.E2E_DB_ID}.db`);
}

// Absolute filesystem path of the e2e SQLite file (strips the `file:` scheme; resolves relative
// paths against the repo root, matching how libSQL interprets them at runtime).
function e2eDbPath(): string {
  const path = E2E_DATABASE_URL.slice("file:".length);
  return resolve(ROOT, path);
}

function run(
  label: string,
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): void {
  // shell:true on Windows so `npx` (a .cmd shim) is launchable — CreateProcess can't exec .cmd files
  // directly, so a bare spawnSync('npx', …) fails with ENOENT. Our args are simple tokens (no spaces
  // or shell metacharacters), so this is quoting-safe. POSIX needs no shell, so keep it off there.
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(
      `Global setup step "${label}" failed (${cmd} ${args.join(" ")})${detail}.`,
    );
  }
}

// Best-effort delete of PREVIOUS runs' e2e database files (and their WAL/SHM sidecars) so they do
// not accumulate in data/. This run's own file is never touched — the dev server may already hold it
// open (see E2E_DATABASE_URL), and unlinking it is precisely the bug this layout avoids. Deletion is
// best-effort because on Windows a just-stopped webServer (or an AV/indexer scan) can hold a handle
// for several seconds; a leftover file is harmless, since each run uses its own name anyway.
function removeStaleE2eDatabases(): void {
  const dir = dirname(e2eDbPath());
  const keep = `${E2E_DB_PREFIX}${process.env.E2E_DB_ID}.db`;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // data/ does not exist yet — nothing stale to clean.
  }
  for (const entry of entries) {
    if (!entry.startsWith(E2E_DB_PREFIX)) continue;
    if (entry === keep || entry.startsWith(`${keep}-`)) continue;
    try {
      rmSync(resolve(dir, entry));
    } catch {
      // Locked by another process — leave it; it costs nothing but disk.
    }
  }
}

// Poll the app's health endpoint until the backend answers. Playwright's `webServer.url` only waits
// for the CLIENT (Vite on 5173); the API server it proxies to boots independently, so without this
// the first specs can race a backend that is not listening yet. Failing here reports one clear
// error instead of a screenful of unrelated assertion failures.
// spec: docs/specs/server-runtime.md §Behaviour.1
async function waitForApi(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:5173/api/health");
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `The API did not become healthy within ${timeoutMs}ms (last: ${lastError}). ` +
      "Is the backend failing to start? Check the [server] output of `npm run dev`.",
  );
}

export default async function globalSetup(): Promise<void> {
  // 1. Ensure the four listening dev clips exist (real, playable MP3s). Generate any missing ones
  //    with ffmpeg — distinct sine tones, 6s each, matching the durations the listening seed uses.
  //    scripts/dev-audio/ is gitignored, so on a fresh checkout (CI) the directory is absent — create
  //    it first, otherwise ffmpeg can't write the output file and fails with a misleading error.
  mkdirSync(AUDIO_DIR, { recursive: true });
  for (let i = 1; i <= 4; i += 1) {
    const file = resolve(
      AUDIO_DIR,
      `listening-dev-q${String(i).padStart(2, "0")}.mp3`,
    );
    if (existsSync(file)) continue;
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${300 + i * 120}:duration=6`,
        "-ac",
        "1",
        "-ar",
        "22050",
        "-b:a",
        "64k",
        file,
      ],
      { stdio: "ignore" },
    );
    if (result.status !== 0) {
      throw new Error(
        `Missing ${file} and ffmpeg could not generate it. Install ffmpeg (brew install ffmpeg) ` +
          `or create the dev clips manually before running the e2e suite.`,
      );
    }
  }

  // 2. Migrate this run's dedicated e2e database, then seed it. All steps run against
  //    E2E_DATABASE_URL (dotenv does not override an already-set DATABASE_URL, so the override holds).
  //    The already-running dev server may have created the file first; migrating it in place (rather
  //    than deleting and recreating it) is what keeps that server pointed at the seeded data.
  removeStaleE2eDatabases();
  const env = { DATABASE_URL: E2E_DATABASE_URL };
  run("migrate e2e db", "npx", ["tsx", "server/db/migrate.ts"], env);
  run("seed reading", "npx", ["tsx", "scripts/seed-dev.ts"], env);
  run("seed listening", "npx", ["tsx", "scripts/seed-listening-dev.ts"], env);

  // 3. Only start the specs once the backend actually answers.
  await waitForApi();
}
