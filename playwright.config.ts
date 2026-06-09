import { defineConfig } from '@playwright/test';

// End-to-end regression suite for the quiz UI (reading + listening). Runs against the dev servers
// (`npm run dev`) using Playwright's bundled Chromium — no system Chrome required. The DB is seeded
// by e2e/global-setup.ts (reading dev seed + listening dev seed with generated audio) before the
// run, so the suite is self-contained. Invoke with `npm run test:e2e`.
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
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
