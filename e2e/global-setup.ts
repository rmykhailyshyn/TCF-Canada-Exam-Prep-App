import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Playwright global setup: make the run self-contained by (1) ensuring the generated listening dev
// audio exists and (2) seeding the reading + listening dev data. All seeds are idempotent.

const ROOT = process.cwd();
const AUDIO_DIR = resolve(ROOT, 'scripts/dev-audio');

function run(label: string, cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Global setup step "${label}" failed (${cmd} ${args.join(' ')}).`);
  }
}

export default function globalSetup(): void {
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

  // 2. Seed reading (dev-seed.pdf) and listening (listening-dev.pdf) data the specs exercise.
  run('seed reading', 'npx', ['tsx', 'scripts/seed-dev.ts']);
  run('seed listening', 'npx', ['tsx', 'scripts/seed-listening-dev.ts']);
}
