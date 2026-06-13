import { defineConfig } from '@playwright/test';
import { E2E_DATABASE_URL } from './e2e/global-setup';

// End-to-end regression suite for the quiz UI (reading + listening). Runs against the dev servers
// (`npm run dev`) using Playwright's bundled Chromium — no system Chrome required. The suite is
// self-contained AND isolated: e2e/global-setup.ts creates, migrates and seeds a DEDICATED
// `tcf_prep_e2e` database (reading + listening dev seeds with generated audio), and the webServer
// below launches the app against that same DB — so the run is deterministic and never touches the
// dev DB (which may hold real imports with several questions per position). Invoke with
// `npm run test:e2e`.
//
// These are intentionally separate from the vitest unit/render tests (vitest.config.ts only globs
// server/scripts/client), so `npm test` and `npm run test:e2e` never collect each other's files.

export default defineConfig({
  testDir: './e2e',
  // The flows mutate shared session state through one set of dev servers; keep them serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        // Allow the listening player to start playback without a real user-gesture gate.
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    // Always start a fresh server bound to the isolated e2e DB; never reuse a dev-DB server that may
    // be running on these ports. (Stop any local `npm run dev` before invoking the e2e suite.)
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: E2E_DATABASE_URL },
  },
});
