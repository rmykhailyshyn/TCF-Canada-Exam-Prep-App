// spec: docs/specs/test-coverage.md §Behaviour.2 (e2e server coverage reaches disk),
// docs/specs/database-sqlite.md §Behaviour.5 (the e2e suite runs on its own isolated database).
//
// These two invariants are invisible in a green local run but silently break CI when removed, so
// they are pinned here rather than left to review:
//
//  1. `webServer.gracefulShutdown` — without it Playwright SIGKILLs the web-server process group on
//     teardown, the server's SIGTERM handler never runs, Node never flushes NODE_V8_COVERAGE, and
//     `coverage:e2e:report` finds an empty temp directory.
//  2. A per-run e2e database filename — Playwright starts `webServer` BEFORE `globalSetup`, so the
//     dev server has normally already opened the file by the time setup runs. Deleting a fixed-name
//     file there strands the running server on an unlinked, table-less inode and every /api call
//     fails for the rest of the run.
import { describe, it, expect } from "vitest";
import playwrightConfig from "../playwright.config";
import { E2E_DATABASE_URL } from "../e2e/global-setup";

const webServer = (
  playwrightConfig as {
    webServer?: {
      gracefulShutdown?: { signal?: string; timeout?: number };
      env?: Record<string, string>;
    };
  }
).webServer;

describe("playwright.config.ts webServer", () => {
  it("shuts the web server down with SIGTERM instead of a force kill", () => {
    expect(webServer?.gracefulShutdown?.signal).toBe("SIGTERM");
    expect(webServer?.gracefulShutdown?.timeout).toBeGreaterThan(0);
  });

  it("points the web server at the isolated e2e database", () => {
    expect(webServer?.env?.DATABASE_URL).toBe(E2E_DATABASE_URL);
  });
});

describe("e2e database url", () => {
  it("is a run-scoped file, never a shared fixed name", () => {
    expect(E2E_DATABASE_URL.startsWith("file:")).toBe(true);
    const filename = E2E_DATABASE_URL.split(/[/\\]/).pop();
    expect(filename).toMatch(/^tcf_prep_e2e-.+\.db$/);
    expect(filename).not.toBe("tcf_prep_e2e.db");
  });

  it("stays stable across imports within one run, via the inherited run id", () => {
    expect(process.env.E2E_DB_ID).toBeTruthy();
    expect(E2E_DATABASE_URL).toContain(
      `tcf_prep_e2e-${process.env.E2E_DB_ID}.db`,
    );
  });
});
