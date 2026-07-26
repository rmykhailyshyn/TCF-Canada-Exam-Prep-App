import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getPort } from "./config/env";
import { createDb } from "./db/factory";
import { fail } from "./lib/envelope";
import { createLlmProviderForNode } from "./lib/llm-provider-node";
import { nodeCapabilities } from "./runtime/capabilities";
import { NodeMediaStore } from "./runtime/node-media-store";
import { createCoreApp } from "./app";
import { type AppVars } from "./routes/app-vars";
import { registerNodeRoutes } from "./routes/node-routes";

// spec: docs/specs/server-runtime.md §Behaviour.1, 5, 6, 8; docs/specs/llm-provider.md §Behaviour.1
// The Node entry.
// Builds the runtime dependencies (libSQL DB via the factory, the filesystem MediaStore, the Node
// capability flags, the LLM provider resolved from LLM_PROVIDER/.env), injects them into every
// request via context Variables, mounts the portable core (createCoreApp), then layers the Node-only
// CLI routes (registerNodeRoutes) and the unknown-/api fallback. Finally serves over HTTP with
// @hono/node-server on the same PORT the client proxies to.
async function main(): Promise<void> {
  const db = await createDb();
  const mediaStore = new NodeMediaStore();
  const llm = createLlmProviderForNode();

  const app = new Hono<{ Variables: AppVars }>();

  // Inject the per-runtime dependencies into the request context. spec: §Runtime abstractions.
  app.use("*", (c, next) => {
    c.set("db", db);
    c.set("mediaStore", mediaStore);
    c.set("capabilities", nodeCapabilities);
    c.set("llm", llm);
    return next();
  });

  // Portable core first, then the Node-only CLI-backed routes.
  app.route("/", createCoreApp());
  registerNodeRoutes(app);

  // Fallback 404 in the standard envelope shape for unknown API routes — registered LAST so it only
  // catches paths no router matched. spec: docs/specs/server-runtime.md §Behaviour.3
  app.all("/api/*", (c) => c.json(fail("NOT_FOUND", "Route not found"), 404));

  const port = getPort();
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  // spec: docs/specs/test-coverage.md §Behaviour.2 — exit gracefully on the signals the process
  // manager (Playwright's webServer / concurrently) sends on teardown, so Node flushes NODE_V8_COVERAGE
  // to disk and the c8 e2e-server coverage report is complete. No-op impact on normal dev/prod runs.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => process.exit(0));
  }
}

void main();
