import { get } from "./http";

// spec: docs/specs/content-deploy.md §Behaviour.8 — the deployed (practice-only) backend reports
// which CLI-backed capabilities are available via GET /api/health. The client gates UI on these.
export type Capabilities = {
  aiScoring: boolean;
  transcription: boolean;
  imports: boolean;
};

const NO_CAPABILITIES: Capabilities = {
  aiScoring: false,
  transcription: false,
  imports: false,
};

// spec: docs/specs/content-deploy.md §Behaviour.8 — fetch the backend capabilities; on ANY failure
// (network, error envelope, or a malformed/missing capabilities object) fall back to the
// most-restrictive set so no capability-gated affordance is ever shown when in doubt (default-deny).
export async function fetchCapabilities(): Promise<Capabilities> {
  try {
    const data = await get<{ capabilities?: unknown }>("/api/health");
    const caps = data.capabilities;
    if (
      typeof caps === "object" &&
      caps !== null &&
      typeof (caps as Capabilities).aiScoring === "boolean" &&
      typeof (caps as Capabilities).transcription === "boolean" &&
      typeof (caps as Capabilities).imports === "boolean"
    ) {
      const c = caps as Capabilities;
      return {
        aiScoring: c.aiScoring,
        transcription: c.transcription,
        imports: c.imports,
      };
    }
    return NO_CAPABILITIES;
  } catch {
    return NO_CAPABILITIES;
  }
}
