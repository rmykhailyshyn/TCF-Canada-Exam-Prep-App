import { defineConfig } from "@playwright/test";
import { E2E_DATABASE_URL } from "./e2e/global-setup";

// End-to-end regression suite for the quiz UI (reading + listening). Runs against the dev servers
// (`npm run dev`) using Playwright's bundled Chromium — no system Chrome required. The suite is
// self-contained AND isolated: e2e/global-setup.ts creates, migrates and seeds a DEDICATED
// per-run `tcf_prep_e2e-<id>` database (reading + listening dev seeds with generated audio), and the webServer
// below launches the app against that same DB — so the run is deterministic and never touches the
// dev DB (which may hold real imports with several questions per position). Invoke with
// `npm run test:e2e`.
//
// These are intentionally separate from the vitest unit/render tests (vitest.config.ts only globs
// server/scripts/client), so `npm test` and `npm run test:e2e` never collect each other's files.

export default defineConfig({
  testDir: "./e2e",
  // The flows mutate shared session state through one set of dev servers; keep them serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 900 },
        // Allow the listening player to start playback without a real user-gesture gate.
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    },
  ],
  webServer: {
    // spec: docs/specs/test-coverage.md §Behaviour.2 (server coverage via a c8-wrapped web-server),
    // §Behaviour.8 (only under COVERAGE=1 — plain `npm run test:e2e` keeps using `npm run dev`). The
    // `env: { DATABASE_URL: E2E_DATABASE_URL }` isolation override is preserved for BOTH commands.
    command:
      process.env.COVERAGE === "1" ? "npm run dev:coverage" : "npm run dev",
    url: "http://localhost:5173",
    // Always start a fresh server bound to the isolated e2e DB; never reuse a dev-DB server that may
    // be running on these ports. (Stop any local `npm run dev` before invoking the e2e suite.)
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DATABASE_URL },
    // Tear the server down with SIGTERM and WAIT for it to close. Without this Playwright force-kills
    // the whole process group (SIGKILL), so server/index.ts's signal handler never runs and Node
    // never flushes NODE_V8_COVERAGE — leaving coverage/.v8-e2e-server missing and
    // `coverage:e2e:report` with nothing to convert. spec: docs/specs/test-coverage.md §Behaviour.2
    gracefulShutdown: { signal: "SIGTERM", timeout: 15_000 },
  },
});
