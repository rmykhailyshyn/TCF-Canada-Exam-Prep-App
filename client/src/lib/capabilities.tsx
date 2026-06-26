import { useEffect, useState, type ReactNode } from "react";
import { type Capabilities, fetchCapabilities } from "./api";
import { ALL_FALSE, CapabilitiesContext } from "./capabilities-context";

// spec: docs/specs/content-deploy.md §Behaviour.3, 8
// Provides the backend capability flags (aiScoring / transcription / imports) to the UI, fetched once
// from GET /api/health on mount. The context + reader hook live in ./capabilities-context (a
// component-free module) so this file exports ONLY the provider component (react-refresh). Until the
// fetch resolves — and on any failure — the value is the most-restrictive set, so no capability-gated
// affordance ever flashes as enabled.
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
