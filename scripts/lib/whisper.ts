import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

// spec: docs/specs/listening-import.md §Behaviour.7, §Behaviour.12
// Apple Silicon / macOS only (CLAUDE.md): wraps the Whisper CLI to transcribe one MP3 into
// phrase-level segments. Defaults to `mlx_whisper` (the Apple-Silicon, pip-installable variant
// already aligned with the Python toolchain); override the binary with WHISPER_CMD, the model
// with WHISPER_MODEL. Non-zero exits and a missing binary are surfaced explicitly so the
// orchestrator can skip the file and continue (Behaviour.12). The JSON→segments transform is a
// pure exported helper so it can be unit-tested without invoking the CLI.

export class WhisperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhisperError';
  }
}

export type TranscriptSegment = {
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type WhisperResult = {
  segments: TranscriptSegment[];
  durationMs: number | null;
};

// The shape emitted by `mlx_whisper --output-format json` (a subset of OpenAI Whisper's JSON):
// a `segments` array of { start, end, text } with timestamps in seconds.
type WhisperJson = {
  text?: string;
  segments?: { start?: number; end?: number; text?: string }[];
};

// spec: docs/specs/listening-import.md §Behaviour.7 — phrase-level (text, start_ms, end_ms).
// Pure transform: converts the CLI's seconds-based JSON into ordered ms segments. Drops blank
// segments, clamps end ≥ start, and reports the clip duration as the last segment's end.
export function parseWhisperJson(raw: string): WhisperResult {
  let json: WhisperJson;
  try {
    json = JSON.parse(raw) as WhisperJson;
  } catch (error) {
    throw new WhisperError(
      `Whisper produced unparseable JSON: ${error instanceof Error ? error.message : error}`,
    );
  }

  const segments: TranscriptSegment[] = [];
  for (const seg of json.segments ?? []) {
    const text = (seg.text ?? '').trim();
    if (!text) continue;
    const startMs = Math.max(0, Math.round((seg.start ?? 0) * 1000));
    const endMs = Math.max(startMs, Math.round((seg.end ?? 0) * 1000));
    segments.push({ sequence: segments.length + 1, text, startMs, endMs });
  }

  const durationMs = segments.length > 0 ? segments[segments.length - 1].endMs : null;
  return { segments, durationMs };
}

// Runs Whisper on an MP3 and returns its phrase-level segments. Throws WhisperError on a missing
// binary, a non-zero exit, or absent/unparseable output. mlx_whisper writes `<name>.json` into
// an output directory, so we transcribe into a throwaway temp dir and read the result back.
export function runWhisper(mp3Path: string): WhisperResult {
  const bin = process.env.WHISPER_CMD ?? 'mlx_whisper';
  const model = process.env.WHISPER_MODEL ?? 'mlx-community/whisper-large-v3-turbo';
  const outDir = mkdtempSync(join(tmpdir(), 'tcf-whisper-'));

  try {
    const result = spawnSync(
      bin,
      [
        mp3Path,
        '--model',
        model,
        '--language',
        'fr',
        '--output-format',
        'json',
        '--output-dir',
        outDir,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    if (result.error) {
      throw new WhisperError(
        `Whisper is not available (${bin}). Install it (\`pip install mlx-whisper\`) or set ` +
          `WHISPER_CMD. Cause: ${result.error.message}`,
      );
    }
    if (result.status !== 0) {
      throw new WhisperError(`Whisper exited ${result.status}: ${result.stderr?.trim()}`);
    }

    // mlx_whisper names the output `<input-basename-without-ext>.json`; fall back to the first
    // `.json` in the dir if the naming differs across CLI versions.
    const expected = `${basename(mp3Path, extname(mp3Path))}.json`;
    const produced = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.json'));
    const jsonName = produced.includes(expected) ? expected : produced[0];
    if (!jsonName) {
      throw new WhisperError(`Whisper produced no JSON output for ${basename(mp3Path)}.`);
    }

    return parseWhisperJson(readFileSync(join(outDir, jsonName), 'utf8'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
