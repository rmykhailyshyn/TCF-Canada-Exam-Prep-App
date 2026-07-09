/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { fail } from "./lib/envelope";
import {
  ClaudeError,
  type LlmConfig,
  type LlmProvider,
  createApiProvider,
  resolveLlmConfig,
} from "./lib/llm-provider";
import { workerCapabilities } from "./runtime/capabilities";
import { R2MediaStore } from "./runtime/r2-media-store";
import { createCoreApp } from "./app";
import { registerPracticeRoutes } from "./routes/practice-routes";
import { type AppVars } from "./routes/app-vars";

// spec: docs/specs/cloud-deployment.md §Behaviour.1–7; §Scope (server/worker.ts entry);
// docs/specs/llm-provider.md §Behaviour.8–9
// The Cloudflare Worker entry. It imports ONLY the portable Hono core (createCoreApp) — never
// registerNodeRoutes, the *-node services, the libSQL factory, or NodeMediaStore — so the bundle
// contains no `node:child_process` / `node:fs` and no CLI-backed route is mounted. Per request it
// builds the Drizzle DB from the D1 binding, wires the R2 MediaStore, and reports capabilities
// (practice-only, except `aiScoring` which turns on when ANTHROPIC_API_KEY is bound — Behaviour.8).
// Static assets + SPA fallback are handled by Workers Static Assets (wrangler.toml `[assets]` with
// `run_worker_first = ["/api/*"]`), so this Worker only serves /api/*.

// Operational binding contract (wrangler.toml). spec: §API contract (Bindings).
export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  // Optional shared-secret fallback when Cloudflare Access is not used. spec: §Scope (Access fallback).
  ACCESS_SHARED_SECRET?: string;
  // spec: docs/specs/llm-provider.md §Behaviour.3, 8 — Worker secrets/vars for online AI scoring. No
  // LLM_PROVIDER binding is needed here: the API provider activates purely on ANTHROPIC_API_KEY being
  // bound (`wrangler secret put ANTHROPIC_API_KEY`); CLAUDE_API_MODEL is required alongside it.
  ANTHROPIC_API_KEY?: string;
  CLAUDE_API_MODEL?: string;
  CLAUDE_API_BASE_URL?: string;
  CLAUDE_API_MAX_TOKENS?: string;
};

// spec: docs/specs/llm-provider.md §Behaviour.8 — build the API provider from Worker bindings when
// ANTHROPIC_API_KEY is bound; undefined (no scoring) when it is not. Reuses resolveLlmConfig by
// forcing LLM_PROVIDER=api since the Worker never reads a CLI config (no local binary to shell out to).
// A misconfiguration (key bound without CLAUDE_API_MODEL) fails safe to "no scoring" rather than
// throwing out of request middleware — a config error must never 500 every request on the Worker.
function resolveWorkerLlm(
  env: Env,
): { provider: LlmProvider; config: LlmConfig } | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined;
  try {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "api",
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      CLAUDE_API_MODEL: env.CLAUDE_API_MODEL,
      CLAUDE_API_BASE_URL: env.CLAUDE_API_BASE_URL,
      CLAUDE_API_MAX_TOKENS: env.CLAUDE_API_MAX_TOKENS,
    });
    if (config.provider !== "api") return undefined;
    return { provider: createApiProvider(config), config };
  } catch (error) {
    if (error instanceof ClaudeError) return undefined;
    throw error;
  }
}

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

// Constant-time string comparison to prevent timing side-channels on the shared-secret check.
// Works in both the Workers runtime and the Node test environment (no runtime-specific API needed).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// spec: docs/specs/cloud-deployment.md §Scope (Access fallback) — documented shared-secret fallback.
// Default deployment relies on Cloudflare Access (no app code). When ACCESS_SHARED_SECRET is set as a
// Worker secret, requests must carry a matching `X-Access-Secret` header to reach any route; when it
// is unset this middleware is a no-op (Access gates the Worker in front).
app.use("*", async (c, next) => {
  const expected = c.env.ACCESS_SHARED_SECRET;
  if (expected && !safeEqual(c.req.header("x-access-secret") ?? "", expected)) {
    return c.json(
      fail("UNAUTHORIZED", "Missing or invalid access secret."),
      401,
    );
  }
  return next();
});

// Inject the per-runtime dependencies into the request context (D1 Drizzle + R2 MediaStore +
// capabilities), mirroring the Node entry's middleware. spec: §Behaviour.3, 6, 7;
// docs/specs/llm-provider.md §Behaviour.8 — `aiScoring` flips true only when an API key is bound.
app.use("*", (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  c.set("mediaStore", new R2MediaStore(c.env.MEDIA));
  const llm = resolveWorkerLlm(c.env);
  c.set("llm", llm);
  c.set(
    "capabilities",
    llm ? { ...workerCapabilities, aiScoring: true } : workerCapabilities,
  );
  return next();
});

// Portable core only — no Node-only CLI routes. spec: §Behaviour.4, 5.
app.route("/", createCoreApp());

// spec: docs/specs/content-deploy.md §Behaviour.4, 5, 7 — practice-only online behaviour. These
// re-expose writing/speaking submit + complete + recording-upload as LOCK / STORE / FINALISE without
// any Claude/Whisper step (capabilities stay all-false). They import only the portable services, so the
// Worker bundle still contains no `node:child_process` / `node:fs`. Registered on a bindings-free
// sub-app and mounted on the root (like createCoreApp) so the root middleware's context propagates.
const practiceApp = new Hono<{ Variables: AppVars }>();
registerPracticeRoutes(practiceApp);
app.route("/", practiceApp);

// Unknown /api/* routes (including the unmounted CLI-backed ones) return the standard NOT_FOUND
// envelope, never a 500 — mirrors server/index.ts. spec: §Behaviour.5.
app.all("/api/*", (c) => c.json(fail("NOT_FOUND", "Route not found"), 404));

export default app;
export { app };
