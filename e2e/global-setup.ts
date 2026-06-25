import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Playwright global setup. Makes the run self-contained AND deterministic by isolating it onto a
// DEDICATED e2e database FILE, so the suite never depends on (or mutates) the dev DB — which may hold
// real imported exams with several questions per position. We (1) ensure the generated listening
// dev audio exists, (2) (re)create + migrate a fresh e2e SQLite file, and (3) seed reading +
// listening dev data. The dev server is launched against this same DB via playwright.config.ts
// `webServer.env`. SQLite is a single file: no Docker, no database server, runs on Windows + macOS.
// spec: docs/specs/database-sqlite.md §Behaviour.5

const ROOT = process.cwd();
const AUDIO_DIR = resolve(ROOT, "scripts/dev-audio");

loadDotenv({ path: resolve(ROOT, ".env") });

// The e2e DB URL, derived from DATABASE_URL by swapping the SQLite filename to `tcf_prep_e2e.db`.
// Exported so playwright.config.ts can point the app's webServer at the same database.
export const E2E_DATABASE_URL = deriveE2eDatabaseUrl();

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
  return base.replace(/[^/\\]+$/, "tcf_prep_e2e.db");
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

// Best-effort delete of any existing e2e database file (and its WAL/SHM sidecars) so a run starts
// from a clean schema when possible. The delete is best-effort because on Windows the previous run's
// webServer (or an AV/indexer scan of the freshly-written file) can hold the handle for several
// seconds after Playwright stops the server; in that case we leave the file in place and rely on the
// idempotent migrate + seeds below (seeds wipe their own source rows before re-inserting), which is
// how the suite stayed deterministic on the previous Postgres setup (it never dropped the DB either).
function resetE2eDatabase(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${e2eDbPath()}${suffix}`;
    try {
      if (existsSync(file)) rmSync(file);
    } catch {
      // Locked — fall back to reusing the file (migrate + seeds are idempotent).
    }
  }
}

export default async function globalSetup(): Promise<void> {
  // 1. Ensure the four listening dev clips exist (real, playable MP3s). Generate any missing ones
  //    with ffmpeg — distinct sine tones, 6s each, matching the durations the listening seed uses.
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

  // 2. Reset + migrate the dedicated e2e database, then seed it. All steps run against
  //    E2E_DATABASE_URL (dotenv does not override an already-set DATABASE_URL, so the override holds).
  resetE2eDatabase();
  const env = { DATABASE_URL: E2E_DATABASE_URL };
  run("migrate e2e db", "npx", ["tsx", "server/db/migrate.ts"], env);
  run("seed reading", "npx", ["tsx", "scripts/seed-dev.ts"], env);
  run("seed listening", "npx", ["tsx", "scripts/seed-listening-dev.ts"], env);
}
