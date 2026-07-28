import { vi } from "vitest";

// Shared fetch double for the client hook/page tests. Routes are matched on `"<METHOD> <path>"`, so
// a test drives the REAL client/src/lib/api.ts (envelope unwrapping, ApiError mapping) rather than
// mocking it away — the api layer is exercised as a side effect of every hook test.

export type Route = string; // e.g. "POST /api/sessions"
export type Handler = (body: unknown) => unknown;

export type FetchStub = {
  /** Every request seen, in order. */
  calls: { method: string; path: string; body: unknown }[];
  /** Replace/add a route after installation (e.g. to make the second call fail). */
  set: (route: Route, handler: Handler) => void;
};

/** Resolve a route with the failure envelope so the caller's ApiError path runs. */
export function apiError(code: string, message: string): Handler {
  return () => ({ __error: { code, message } });
}

/**
 * Install a `fetch` stub over the given routes. Handlers return the `data` payload; wrap a return in
 * `apiError(...)` for a failure envelope. Unrouted requests reject, so a missing stub is a loud test
 * failure rather than a silent hang.
 */
export function stubFetch(routes: Record<Route, Handler>): FetchStub {
  const table = new Map(Object.entries(routes));
  const calls: FetchStub["calls"] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: { method?: string; body?: unknown }) => {
      const method = init?.method ?? "GET";
      const path = String(input);
      // The speaking upload posts FormData, everything else a JSON string.
      const raw = init?.body;
      const body: unknown =
        typeof raw === "string" ? JSON.parse(raw) : (raw ?? undefined);
      calls.push({ method, path, body });

      const handler = table.get(`${method} ${path}`);
      if (!handler) {
        throw new Error(`Unrouted fetch in test: ${method} ${path}`);
      }
      const result = handler(body) as { __error?: unknown };
      const envelope =
        result && typeof result === "object" && "__error" in result
          ? { data: null, error: result.__error }
          : { data: result, error: null };
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(envelope),
      };
    }),
  );

  return {
    calls,
    set: (route, handler) => table.set(route, handler),
  };
}
