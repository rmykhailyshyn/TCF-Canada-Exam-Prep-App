import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedResults } from "./results";

// spec: docs/specs/reading-import.md §PDF structure
// Invokes the Python pdfplumber parser and returns its JSON. Keeps DB access out of Python
// (CLAUDE.md §Drizzle): Python parses, TS persists.

const here = dirname(fileURLToPath(import.meta.url)); // scripts/lib
const repoRoot = resolve(here, "../..");

// Default to the pipeline venv; override with PYTHON_BIN for a custom interpreter.
function pythonBin(): string {
  return (
    process.env.PYTHON_BIN ?? resolve(repoRoot, "scripts/.venv/bin/python3")
  );
}

export function runPdfParser(pdfPath: string): ParsedResults {
  const script = resolve(repoRoot, "scripts/parse_results_pdf.py");
  const result = spawnSync(pythonBin(), [script, pdfPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `Failed to launch the Python parser (${pythonBin()}). Create the venv with ` +
        `\`python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt\`. ` +
        `Cause: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `PDF parse failed: ${result.stderr?.trim() || "unknown error"}`,
    );
  }
  return JSON.parse(result.stdout) as ParsedResults;
}
