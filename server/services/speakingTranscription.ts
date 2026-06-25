import { WhisperError, runWhisper } from "../../scripts/lib/whisper";

// spec: docs/specs/speaking-evaluation.md §Behaviour.2–5
// Request-time transcription for the Speaking section. Reuses the shared Whisper wrapper
// (scripts/lib/whisper.ts — Apple Silicon / macOS only) that the listening import uses, then
// concatenates its phrase-level segments into a single transcript string for the response row.
// A missing/failing Whisper binary surfaces as WhisperError so the caller (server/services/speaking)
// can return TRANSCRIPTION_FAILED while retaining the saved audio for a retry.

export type TranscriptionResult = {
  transcript: string;
  durationMs: number | null;
};

// spec: docs/specs/speaking-evaluation.md §Behaviour.4 — concatenate segments into one transcript.
export function transcribeFile(audioPath: string): TranscriptionResult {
  const { segments, durationMs } = runWhisper(audioPath);
  const transcript = segments
    .map((s) => s.text.trim())
    .filter((t) => t.length > 0)
    .join(" ")
    .trim();
  return { transcript, durationMs };
}

export { WhisperError };
