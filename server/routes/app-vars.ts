import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { DbClient } from "../db/factory";
import type { Capabilities } from "../runtime/capabilities";
import type { MediaStore } from "../runtime/media-store";
import type { LlmConfig, LlmProvider } from "../lib/llm-provider";
import { ApiError } from "../lib/errors";
import { fail } from "../lib/envelope";
import { parseRange } from "../lib/range";

// spec: docs/specs/server-runtime.md §Runtime abstractions; §Behaviour.5, 6; docs/specs/llm-provider.md
// §Behaviour.8
// Per-request dependencies injected via Hono's context Variables. The same shape is set by the Node
// entry (libSQL + filesystem MediaStore + nodeCapabilities) and by the Worker entry (D1 + R2 + worker
// capabilities), so every router binds to whichever runtime mounted it. `llm` is optional: the Node
// entry always sets it (CLI or API provider, per config); the Worker sets it only when
// ANTHROPIC_API_KEY is bound, so its absence is how a handler (e.g. routes/practice-routes.ts) tells
// whether online scoring is available. Each sub-router must redeclare `new Hono<{ Variables: AppVars
// }>()` to see these typed accessors.
export type AppVars = {
  db: DbClient;
  mediaStore: MediaStore;
  capabilities: Capabilities;
  llm?: { provider: LlmProvider; config: LlmConfig };
};

// spec: docs/specs/server-runtime.md §Behaviour.2 — render a thrown error into the standard failure
// envelope. ApiError carries its own code + HTTP status; anything else is an opaque 500 INTERNAL.
// Argument order is `(error, c)` to match Hono's `onError` handler signature; the Node-only routes
// also call it directly from their try/catch. Used by every router so handlers `throw new ApiError`.
export function errorResponse(error: unknown, c: Context): Response {
  if (error instanceof ApiError) {
    return c.json(
      fail(error.code, error.message),
      error.status as ContentfulStatusCode,
    );
  }
  console.error("Unexpected error in route:", error);
  return c.json(fail("INTERNAL", "An unexpected error occurred."), 500);
}

// Parse a JSON request body, tolerating an absent/empty/invalid body by returning {} — matching the
// previous global express.json() behaviour where handlers read `req.body ?? {}`.
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return (body ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// spec: docs/specs/server-runtime.md §Behaviour.6 — stream media bytes through the MediaStore with
// HTTP range support. A full request returns 200; a ranged request returns 206 with Content-Range; an
// unsatisfiable Range returns 416 with `Content-Range: bytes */<size>` and an empty body. `rangeable`
// controls whether the Range header is honoured (audio/recordings yes; passage images no). The
// `missing` callback throws the route-appropriate 404 (NOT_FOUND vs PASSAGE_IMAGE_NOT_FOUND).
export async function serveMedia(
  c: Context,
  key: string,
  contentType: string,
  options: { rangeable: boolean; missing: () => never },
): Promise<Response> {
  const store = c.get("mediaStore") as MediaStore;
  const meta = await store.stat(key);
  if (!meta) options.missing();
  const size = meta.size;

  const headers: Record<string, string> = { "Content-Type": contentType };
  if (!options.rangeable) {
    headers["Content-Length"] = String(size);
    const body = await store.getRange(key);
    return c.body(body, 200, headers);
  }

  headers["Accept-Ranges"] = "bytes";
  const rangeHeader = c.req.header("range");
  const range = parseRange(rangeHeader, size);
  if (rangeHeader && !range) {
    return c.body(null, 416, { "Content-Range": `bytes */${size}` });
  }

  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    const body = await store.getRange(key, range);
    return c.body(body, 206, headers);
  }

  headers["Content-Length"] = String(size);
  const body = await store.getRange(key);
  return c.body(body, 200, headers);
}
