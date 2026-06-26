import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { type Capabilities, fetchCapabilities } from "./api";

// spec: docs/specs/content-deploy.md §Behaviour.3, 8
// Provides the backend capability flags (aiScoring / transcription / imports) to the UI, fetched
// once from GET /api/health on mount. Until the fetch resolves — and on any failure — the value is
// the most-restrictive set (all false), so no capability-gated affordance ever flashes as enabled.

const ALL_FALSE: Capabilities = {
  aiScoring: false,
  transcription: false,
  imports: false,
};

// Exported so tests can supply a fixed capability value via <CapabilitiesContext.Provider>.
export const CapabilitiesContext = createContext<Capabilities>(ALL_FALSE);

// spec: docs/specs/content-deploy.md §Behaviour.3, 8 — fetch capabilities once and expose them.
export function CapabilitiesProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [capabilities, setCapabilities] = useState<Capabilities>(ALL_FALSE);

  useEffect(() => {
    let active = true;
    void fetchCapabilities().then((caps) => {
      if (active) setCapabilities(caps);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <CapabilitiesContext.Provider value={capabilities}>
      {children}
    </CapabilitiesContext.Provider>
  );
}

// spec: docs/specs/content-deploy.md §Behaviour.3, 8 — read the current capability flags.
export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
