import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// spec: docs/specs/test-coverage.md §Behaviour.2 (e2e SERVER coverage: raw V8 coverage emitted by the
// c8-instrumented dev:server:coverage web-server → an istanbul-compatible json report).
//
// The Node server is run during the e2e suite with NODE_V8_COVERAGE pointing at the c8 temp-directory
// (see the `dev:server:coverage` npm script); Node writes one raw V8 coverage file per process on
// graceful exit (the server installs a SIGTERM/SIGINT handler so Playwright's webServer teardown flushes
// it). This script converts that raw V8 data into an istanbul `coverage-final.json` under the configured
// reports-dir, mapping back to the original `server/**/*.ts` sources via tsx's inline source maps.
//
// It reads the same `.c8rc.json` a `c8 report` would, and drives c8's own report pipeline
// (`c8/lib/commands/report.js` → the `Report` class + v8-to-istanbul) directly rather than the `c8` CLI,
// because the CLI's yargs dependency fails to load under the installed Node (extensionless ESM `require`
// of `yargs/yargs`). The report library path is yargs-free, so the output equals `c8 report`'s.

type C8Config = {
  reporter: string[];
  "reports-dir": string;
  "temp-directory": string;
  extension: string[];
  include: string[];
  exclude: string[];
  all: boolean;
  "exclude-node-modules": boolean;
};

// c8 ships CommonJS; load it through createRequire from this ESM module.
const require = createRequire(import.meta.url);
const { outputReport } = require("c8/lib/commands/report.js") as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- c8's report lib ships no type declarations.
  outputReport: (argv: Record<string, any>) => Promise<void>;
};

async function main(): Promise<void> {
  const cfg = JSON.parse(
    readFileSync(resolve(process.cwd(), ".c8rc.json"), "utf8"),
  ) as C8Config;

  await outputReport({
    tempDirectory: resolve(process.cwd(), cfg["temp-directory"]),
    "reports-dir": resolve(process.cwd(), cfg["reports-dir"]),
    reporter: cfg.reporter,
    include: cfg.include,
    exclude: cfg.exclude,
    extension: cfg.extension,
    all: cfg.all,
    excludeNodeModules: cfg["exclude-node-modules"],
    src: [process.cwd()],
    resolve: "",
    reporterOptions: {},
  });
  // eslint-disable-next-line no-console -- developer-facing tooling output.
  console.log(`Wrote e2e server coverage report to ${cfg["reports-dir"]}/`);
}

void main();
