import { Hono } from "hono";
import { type AppVars } from "./routes/app-vars";
import { healthRouter } from "./routes/health";
import { questionsRouter } from "./routes/questions";
import { sessionsRouter } from "./routes/sessions";
import { speakingRouter } from "./routes/speaking";
import { writingRouter } from "./routes/writing";

// spec: docs/specs/server-runtime.md §Behaviour.8; §Scope (portable core)
// The runtime-agnostic core app: mounts ONLY the portable routers (health + the CLI-free read/write
// endpoints). It imports nothing from `node:fs` / `node:child_process` — no NodeMediaStore, no
// `*-node` services, no claude-cli / whisper — so it can be mounted unchanged on the future
// Cloudflare Worker entry (Milestone 15). The Node entry (server/index.ts) mounts this, then layers
// the CLI-backed routes via registerNodeRoutes. Dependencies (db, mediaStore, capabilities) are
// supplied by the mounting entry's middleware through Hono context Variables (AppVars).
export function createCoreApp(): Hono<{ Variables: AppVars }> {
  const app = new Hono<{ Variables: AppVars }>();

  app.route("/api/health", healthRouter);
  app.route("/api/sessions", sessionsRouter);
  app.route("/api/questions", questionsRouter);
  app.route("/api/writing", writingRouter);
  app.route("/api/speaking", speakingRouter);

  return app;
}
