import { spawnSync } from "node:child_process";
import {
  ClaudeError,
  JSON_ONLY_SYSTEM_PROMPT,
  type JsonSchema,
  extractJsonObject,
} from "./llm-provider";

// spec: docs/specs/writing-evaluation.md §Behaviour.1–2 (and llm-enrichment §Behaviour.2, 3d, 7)
// Shared local-Claude-CLI primitives, reused by the enrichment script (scripts/lib/claude.ts) and
// (historically) the request-time writing evaluation service. Following the project's CLI-wrapper
// convention: the JSON-extraction and envelope parsers are pure exported helpers (unit-tested without
// spawning the CLI); only `runClaude` touches the process. A missing binary, a non-zero exit, and
// unparseable output are surfaced as ClaudeError so callers can map them to a typed failure
// (skip-and-continue for the script; an error envelope for the server).
//
// spec: docs/specs/llm-provider.md §Behaviour.2, 4 — ClaudeError / JSON_ONLY_SYSTEM_PROMPT / JsonSchema
// / extractJsonObject now live in the portable seam (../lib/llm-provider) so Worker-safe modules
// (writingEvaluation.ts, speakingEvaluation.ts) can use them without pulling in node:child_process.
// Re-exported here unchanged so every existing import from "./claude-cli" keeps working.
export { ClaudeError, JSON_ONLY_SYSTEM_PROMPT, extractJsonObject };
export type { JsonSchema };

// Bounded retries owned by runClaudeJson (Behaviour.3g): DEFAULT_RETRIES additional attempts after the
// first, so 3 total by default. Only parse/validation failures retry; spawn/exit failures fail fast.
const DEFAULT_RETRIES = 2;

// How much of the raw model output to surface in the final-failure error for diagnosis (Behaviour.7).
const RAW_OUTPUT_DIAGNOSTIC_CHARS = 500;

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
  // Grounding (shared across every call site): a JSON Schema constrains the model's content via
  // --json-schema (Behaviour.3f); systemPrompt is appended via --append-system-prompt and defaults to
  // JSON_ONLY_SYSTEM_PROMPT (Behaviour.3e). Pass `systemPrompt: null` to opt out (e.g. raw debugging).
  jsonSchema?: JsonSchema;
  systemPrompt?: string | null;
  // Parse-failure retries owned by runClaudeJson (Behaviour.3g). Additional attempts after the first.
  retries?: number;
};

// Invoke the local CLI non-interactively and return the model's reply text. CLI config comes from
// .env (CLAUDE_CLI_BIN / CLAUDE_CLI_MODEL); no API key. The call is grounded by default — a JSON-only
// system prompt, plus a JSON Schema when one is supplied — so the model emits a parseable object.
// spec: docs/specs/llm-enrichment.md §Behaviour.3e–3f
export function runClaude(prompt: string, opts: RunClaudeOptions = {}): string {
  const bin = opts.bin ?? process.env.CLAUDE_CLI_BIN ?? "claude";
  const model = opts.model ?? process.env.CLAUDE_CLI_MODEL;
  // --safe-mode disables project customizations (CLAUDE.md, hooks, plugins, skills, MCP, output
  // styles, …) so each one-shot call is clean and deterministic; auth, model selection, built-in
  // tools, and the grounding flags below keep working. spec: docs/specs/llm-enrichment.md §Behaviour.3d
  const args = ["-p", prompt, "--safe-mode", "--output-format", "json"];
  if (model) args.push("--model", model);
  const systemPrompt =
    opts.systemPrompt === undefined
      ? JSON_ONLY_SYSTEM_PROMPT
      : opts.systemPrompt;
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (opts.jsonSchema)
    args.push("--json-schema", JSON.stringify(opts.jsonSchema));

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

// Run the CLI and parse its reply into T, retrying on a parse/validation failure with a corrective
// re-prompt. A spawn / non-zero-exit / envelope failure (thrown by runClaude) is NOT retried — it
// propagates immediately (Behaviour.3g, fail fast). Only a ClaudeError from `parse` (the model emitted
// unparseable or schema-violating content) triggers a retry. When every attempt fails to parse, the
// raw model output is surfaced (truncated) so the cause is diagnosable (Behaviour.7).
// spec: docs/specs/llm-enrichment.md §Behaviour.3g, 7
export function runClaudeJson<T>(
  prompt: string,
  parse: (raw: string) => T,
  opts: RunClaudeOptions = {},
): T {
  const attempts = Math.max(1, 1 + (opts.retries ?? DEFAULT_RETRIES));
  let lastRaw: string | undefined;
  let lastError: ClaudeError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptPrompt =
      attempt === 1 ? prompt : `${prompt}\n\n${correctiveSuffix(attempt)}`;
    // A spawn/exit/envelope failure here is non-retryable and propagates out of the loop.
    const raw = runClaude(attemptPrompt, opts);
    lastRaw = raw;
    try {
      return parse(raw);
    } catch (error) {
      if (error instanceof ClaudeError) {
        lastError = error;
        continue; // model produced unparseable / invalid content — retry with a corrective nudge
      }
      throw error;
    }
  }
  throw new ClaudeError(
    `${lastError?.message ?? "Could not parse a JSON object from the model output."} ` +
      `(after ${attempts} attempt${attempts === 1 ? "" : "s"}). ` +
      `Raw model output: ${truncateForDiagnostic(lastRaw ?? "")}`,
  );
}

// The corrective instruction appended to the prompt on each retry. Varied by attempt index so the
// re-prompt is not a byte-for-byte repeat of the previous turn.
function correctiveSuffix(attempt: number): string {
  return (
    `IMPORTANT: your previous reply (attempt ${attempt - 1}) could not be parsed as JSON. ` +
    "Respond with ONLY the JSON object described above — no prose, no markdown fence, no apology, " +
    "and no clarifying question."
  );
}

function truncateForDiagnostic(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "(empty)";
  if (trimmed.length <= RAW_OUTPUT_DIAGNOSTIC_CHARS) return trimmed;
  return `${trimmed.slice(0, RAW_OUTPUT_DIAGNOSTIC_CHARS)}… [truncated, ${trimmed.length} chars total]`;
}
