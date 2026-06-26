/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { fail } from "./lib/envelope";
import { workerCapabilities } from "./runtime/capabilities";
import { R2MediaStore } from "./runtime/r2-media-store";
import { createCoreApp } from "./app";
import { type AppVars } from "./routes/app-vars";

// spec: docs/specs/cloud-deployment.md §Behaviour.1–7; §Scope (server/worker.ts entry)
// The Cloudflare Worker entry. It imports ONLY the portable Hono core (createCoreApp) — never
// registerNodeRoutes, the *-node services, the libSQL factory, or NodeMediaStore — so the bundle
// contains no `node:child_process` / `node:fs` and no CLI-backed route is mounted. Per request it
// builds the Drizzle DB from the D1 binding, wires the R2 MediaStore, and reports all-false
// capabilities (practice-only). Static assets + SPA fallback are handled by Workers Static Assets
// (wrangler.toml `[assets]` with `run_worker_first = ["/api/*"]`), so this Worker only serves /api/*.

// Operational binding contract (wrangler.toml). spec: §API contract (Bindings).
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  // Optional shared-secret fallback when Cloudflare Access is not used. spec: §Scope (Access fallback).
  ACCESS_SHARED_SECRET?: string;
};

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

// spec: docs/specs/cloud-deployment.md §Scope (Access fallback) — documented shared-secret fallback.
// Default deployment relies on Cloudflare Access (no app code). When ACCESS_SHARED_SECRET is set as a
// Worker secret, requests must carry a matching `X-Access-Secret` header to reach any route; when it
// is unset this middleware is a no-op (Access gates the Worker in front).
app.use("*", async (c, next) => {
  const expected = c.env.ACCESS_SHARED_SECRET;
  if (expected && c.req.header("x-access-secret") !== expected) {
    return c.json(
      fail("UNAUTHORIZED", "Missing or invalid access secret."),
      401,
    );
  }
  return next();
});

// Inject the per-runtime dependencies into the request context (D1 Drizzle + R2 MediaStore +
// all-false capabilities), mirroring the Node entry's middleware. spec: §Behaviour.3, 6, 7.
app.use("*", (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  c.set("mediaStore", new R2MediaStore(c.env.MEDIA));
  c.set("capabilities", workerCapabilities);
  return next();
});

// Portable core only — no Node-only CLI routes. spec: §Behaviour.4, 5.
app.route("/", createCoreApp());

// Unknown /api/* routes (including the unmounted CLI-backed ones) return the standard NOT_FOUND
// envelope, never a 500 — mirrors server/index.ts. spec: §Behaviour.5.
app.all("/api/*", (c) => c.json(fail("NOT_FOUND", "Route not found"), 404));

export default app;
export { app };
