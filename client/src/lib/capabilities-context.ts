import { createContext, useContext } from "react";
import type { Capabilities } from "./api";

// spec: docs/specs/content-deploy.md §Behaviour.3, 8
// The backend capability flags context + reader hook. Kept in a component-free module (no JSX) so the
// provider file (capabilities.tsx) can export ONLY its component and satisfy react-refresh. Until the
// provider's fetch resolves — and on any failure — the value is the most-restrictive set (all false),
// so no capability-gated affordance ever flashes as enabled.
export const ALL_FALSE: Capabilities = {
  aiScoring: false,
  transcription: false,
  imports: false,
};

// Exported so tests can supply a fixed capability value via <CapabilitiesContext.Provider>.
export const CapabilitiesContext = createContext<Capabilities>(ALL_FALSE);

// spec: docs/specs/content-deploy.md §Behaviour.3, 8 — read the current capability flags.
export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
