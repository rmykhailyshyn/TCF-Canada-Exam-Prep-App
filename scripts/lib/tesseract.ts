import { spawnSync } from "node:child_process";

// spec: docs/specs/reading-import.md §Behaviour.5, §Behaviour.9
// Apple Silicon / macOS only (CLAUDE.md): wraps the Tesseract OCR CLI for the passage-image path.
// Always surfaces non-zero exits and a missing binary explicitly so the caller can skip the
// question and continue (Behaviour.9).

export class TesseractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TesseractError";
  }
}

// Runs Tesseract on a PNG and returns the extracted text. Throws TesseractError on failure.
export function runTesseract(pngPath: string, lang = "fra"): string {
  const bin = process.env.TESSERACT_BIN ?? "tesseract";
  const result = spawnSync(bin, [pngPath, "stdout", "-l", lang], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new TesseractError(
      `Tesseract is not available (${bin}). Install it (\`brew install tesseract tesseract-lang\`) ` +
        `or set TESSERACT_BIN. Cause: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new TesseractError(
      `Tesseract exited ${result.status}: ${result.stderr?.trim()}`,
    );
  }
  return result.stdout.trim();
}
