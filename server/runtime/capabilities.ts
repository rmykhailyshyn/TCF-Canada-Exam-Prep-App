// spec: docs/specs/server-runtime.md §Behaviour.4
// Per-runtime feature flags surfaced through GET /api/health and used to decide which routes are
// mounted. The Node runtime can spawn the local CLIs (Claude/Whisper) and run imports, so all flags
// are true; the future Cloudflare Worker runtime (Milestone 15) reports all false.

export type Capabilities = {
  aiScoring: boolean;
  transcription: boolean;
  imports: boolean;
};

// spec: docs/specs/server-runtime.md §Behaviour.4 — Node has the full feature set.
export const nodeCapabilities: Capabilities = {
  aiScoring: true,
  transcription: true,
  imports: true,
};
