import { Hono } from "hono";
import { ok } from "../lib/envelope";
import { type AppVars, errorResponse } from "./app-vars";

// spec: docs/specs/server-runtime.md §Behaviour.4; API contract — liveness probe + capability flags.
// Returns { status: 'ok', capabilities } so the client (Milestone 16) can gate CLI-backed features by
// runtime. On Node all flags are true; the Worker (M15) reports all false.
export const healthRouter = new Hono<{ Variables: AppVars }>();

healthRouter.onError(errorResponse);

healthRouter.get("/", (c) =>
  c.json(ok({ status: "ok", capabilities: c.get("capabilities") })),
);
