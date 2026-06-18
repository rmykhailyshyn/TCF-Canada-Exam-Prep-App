import type { SpeakingMode } from '../../lib/api';

// spec: docs/specs/speaking-ui.md §Entry & mode selection — the config the setup screen produces.
// In training the user may pick a single task or all three; real mode always runs all three.
export type SpeakingConfig = {
  mode: SpeakingMode;
  taskNumbers?: number[];
};

// Pick a MediaRecorder MIME the browser supports, preferring Opus-in-WebM (what the server expects).
// spec: docs/specs/speaking-ui.md §Open questions (1) — MediaRecorder MIME type.
export function preferredAudioMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  const Rec = typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined;
  if (Rec && typeof Rec.isTypeSupported === 'function') {
    for (const c of candidates) {
      if (Rec.isTypeSupported(c)) return c;
    }
  }
  return '';
}
