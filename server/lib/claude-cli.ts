import { spawnSync } from "node:child_process";

// spec: docs/specs/writing-evaluation.md §Behaviour.1–2 (and llm-enrichment §Behaviour.2, 3d, 7)
// Shared local-Claude-CLI primitives, reused by the enrichment script (scripts/lib/claude.ts) and
// the request-time writing evaluation service (server/services/writingEvaluation.ts). Following the
// project's CLI-wrapper convention: the JSON-extraction and envelope parsers are pure exported
// helpers (unit-tested without spawning the CLI); only `runClaude` touches the process. A missing
// binary, a non-zero exit, and unparseable output are surfaced as ClaudeError so callers can map
// them to a typed failure (skip-and-continue for the script; an error envelope for the server).

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

// Extract the first balanced JSON object so a stray code fence or surrounding prose doesn't break
// parsing. Respects string literals/escapes.
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1)
    throw new ClaudeError("No JSON object found in model output.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new ClaudeError("Unterminated JSON object in model output.");
}

// `claude -p --output-format json` wraps the model's reply in an envelope; pull out the `result`
// string (or surface a reported error).
export function parseCliEnvelope(stdout: string): string {
  let env: { is_error?: boolean; result?: unknown };
  try {
    env = JSON.parse(stdout) as typeof env;
  } catch {
    throw new ClaudeError(
      "Claude CLI did not return a JSON envelope (is --output-format json set?).",
    );
  }
  if (env.is_error) {
    const detail =
      typeof env.result === "string" ? env.result : "unknown error";
    throw new ClaudeError(`Claude CLI reported an error: ${detail}`);
  }
  if (typeof env.result !== "string") {
    throw new ClaudeError('Claude CLI envelope had no string "result".');
  }
  return env.result;
}

export type RunClaudeOptions = {
  bin?: string;
  model?: string;
  timeoutMs?: number;
};

// Invoke the local CLI non-interactively and return the model's reply text. CLI config comes from
// .env (CLAUDE_CLI_BIN / CLAUDE_CLI_MODEL); no API key.
export function runClaude(prompt: string, opts: RunClaudeOptions = {}): string {
  const bin = opts.bin ?? process.env.CLAUDE_CLI_BIN ?? "claude";
  const model = opts.model ?? process.env.CLAUDE_CLI_MODEL;
  const args = ["-p", prompt, "--output-format", "json"];
  if (model) args.push("--model", model);

  const result = spawnSync(bin, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 180_000,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ClaudeError(
        `Claude CLI not found (${bin}). Install the Claude CLI or set CLAUDE_CLI_BIN in .env.`,
      );
    }
    throw new ClaudeError(`Claude CLI failed to run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new ClaudeError(
      `Claude CLI exited ${result.status}: ${result.stderr?.trim() ?? ""}`,
    );
  }
  return parseCliEnvelope(result.stdout);
}
