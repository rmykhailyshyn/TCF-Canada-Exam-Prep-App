// spec: docs/specs/llm-provider.md
// The provider seam (Milestone 17): one async `complete()` operation that every LLM call site goes
// through, so the app is decoupled from requiring the local `claude` CLI. This module is the
// PORTABLE half — no `node:*` imports — so it can be mounted on the Cloudflare Worker as well as
// Node. The CLI provider (which needs `node:child_process`) lives in the Node-only sibling
// `server/lib/llm-provider-node.ts`; this module owns the shared types, the config factory, the API
// provider (native `fetch`, works on both runtimes), and the provider-agnostic JSON retry helper.

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeError";
  }
}

// spec: docs/specs/llm-enrichment.md §Behaviour.3e — grounding the model to emit JSON only. Shared by
// both providers; passed to the CLI via --append-system-prompt, and to the API via the `system` param.
export const JSON_ONLY_SYSTEM_PROMPT =
  "You are a JSON-only API. Respond with exactly one JSON object matching the requested shape and " +
  "nothing else — no prose, no markdown fences, no apologies, and never ask a clarifying question.";

// A JSON Schema object threaded through `complete()` (Behaviour.4). Free-form by design — the caller
// owns the exact shape; each provider translates it into its own grounding mechanism.
export type JsonSchema = Record<string, unknown>;

// Extract the first balanced JSON object so a stray code fence or surrounding prose doesn't break
// parsing. Respects string literals/escapes. Pure — no process/network — shared by every call site.
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

// spec: docs/specs/llm-provider.md §API contract — the internal provider seam. `jsonSchema` /
// `systemPrompt` are the grounding opts the CLI path already had (llm-enrichment.md §Behaviour.3e–3f);
// every provider must honour them so the M17 seam doesn't regress that behaviour.
export type CompleteOptions = {
  model?: string;
  timeoutMs?: number;
  jsonSchema?: JsonSchema;
  systemPrompt?: string | null;
};

export type LlmProvider = {
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
};

// spec: docs/specs/llm-provider.md §API contract — config the factory reads from the environment.
export type LlmConfig =
  | { provider: "cli"; bin: string; model?: string }
  | {
      provider: "api";
      apiKey: string;
      model: string;
      baseUrl: string;
      maxTokens: number;
    };

const DEFAULT_API_BASE_URL = "https://api.anthropic.com";
// spec: docs/specs/llm-provider.md Open Questions — "Default max_tokens" — large enough for the
// longest correction reply (a rewritten essay + suggestions) without being unbounded.
const DEFAULT_API_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = "2023-06-01";
// spec: docs/specs/llm-provider.md Open Questions — a single attempt with a bounded timeout mirroring
// the CLI's 180s default, no cross-provider fallback.
export const DEFAULT_API_TIMEOUT_MS = 180_000;

// spec: docs/specs/llm-provider.md §Behaviour.1–3 — LLM_PROVIDER selects the backend (defaults to
// "cli" for any unset/unrecognised value, so an existing checkout behaves exactly as it does today).
// `env` is a plain string-keyed record so this factory works against both Node's `process.env` and a
// Worker's `c.env` bindings object.
export function resolveLlmConfig(
  env: Record<string, string | undefined>,
): LlmConfig {
  if (env.LLM_PROVIDER === "api") {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new ClaudeError(
        "LLM_PROVIDER=api requires ANTHROPIC_API_KEY to be set.",
      );
    }
    const model = env.CLAUDE_API_MODEL;
    if (!model) {
      throw new ClaudeError(
        "LLM_PROVIDER=api requires CLAUDE_API_MODEL to be set.",
      );
    }
    return {
      provider: "api",
      apiKey,
      model,
      baseUrl: env.CLAUDE_API_BASE_URL || DEFAULT_API_BASE_URL,
      maxTokens: env.CLAUDE_API_MAX_TOKENS
        ? Number(env.CLAUDE_API_MAX_TOKENS)
        : DEFAULT_API_MAX_TOKENS,
    };
  }
  return {
    provider: "cli",
    bin: env.CLAUDE_CLI_BIN || "claude",
    model: env.CLAUDE_CLI_MODEL || undefined,
  };
}

// spec: docs/specs/llm-provider.md §Behaviour.7 — the provenance string persisted to `generated_by`.
export function providerLabel(config: LlmConfig): string {
  if (config.provider === "cli") {
    return config.model ? `claude-cli/${config.model}` : "claude-cli";
  }
  return `claude-api/${config.model}`;
}

// Fold the grounding opts into the outbound API request. spec: docs/specs/llm-provider.md §API
// contract — the wire shape only shows model/max_tokens/messages; `system` is added when a system
// prompt is resolved, and a jsonSchema is translated into schema-describing text appended to it
// (rather than tool-use, so the response stays a plain text block as the contract documents).
function buildSystemPrompt(opts: CompleteOptions): string | undefined {
  const systemPrompt =
    opts.systemPrompt === undefined
      ? JSON_ONLY_SYSTEM_PROMPT
      : opts.systemPrompt;
  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);
  if (opts.jsonSchema) {
    parts.push(
      `The reply must be a single JSON object satisfying this JSON Schema:\n${JSON.stringify(opts.jsonSchema)}`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

type MessagesApiResponse = {
  content?: { type: string; text?: string }[];
};

// spec: docs/specs/llm-provider.md §Behaviour.4–5; §API contract — the API provider. A single
// `POST {baseUrl}/v1/messages` per call; no dependency, works on both Node's `fetch` and the Workers
// runtime. Every failure mode (non-2xx, network error, content-less response) surfaces as ClaudeError.
export function createApiProvider(
  config: Extract<LlmConfig, { provider: "api" }>,
): LlmProvider {
  return {
    async complete(prompt, opts = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        opts.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
      );
      const system = buildSystemPrompt(opts);
      let res: Response;
      try {
        res = await fetch(`${config.baseUrl}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": config.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: opts.model ?? config.model,
            max_tokens: config.maxTokens,
            ...(system ? { system } : {}),
            messages: [{ role: "user", content: prompt }],
          }),
          signal: controller.signal,
        });
      } catch (error) {
        throw new ClaudeError(
          `Claude API request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new ClaudeError(
          `Claude API responded ${res.status}: ${detail.slice(0, 500)}`,
        );
      }

      let body: MessagesApiResponse;
      try {
        body = (await res.json()) as MessagesApiResponse;
      } catch {
        throw new ClaudeError("Claude API response was not valid JSON.");
      }

      const text = (body.content ?? [])
        .filter(
          (block): block is { type: string; text: string } =>
            block.type === "text" && typeof block.text === "string",
        )
        .map((block) => block.text)
        .join("");
      if (!text) {
        throw new ClaudeError("Claude API response had no text content.");
      }
      return text;
    },
  };
}

// Bounded retries on a parse/validation failure (llm-enrichment.md §Behaviour.3g). Additional
// attempts after the first, so 3 total by default.
const DEFAULT_RETRIES = 2;
// How much of the raw model output to surface in the final-failure error for diagnosis.
const RAW_OUTPUT_DIAGNOSTIC_CHARS = 500;

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

// spec: docs/specs/llm-provider.md §Behaviour.6 — provider-agnostic replacement for the CLI-only
// `runClaudeJson`: call any LlmProvider, parse its reply into T, retrying on a parse/validation
// failure with a corrective re-prompt. A `complete()` failure (spawn/exit/network/non-2xx) is NOT
// retried — it propagates immediately (fail fast, no cross-provider fallback).
export async function completeJson<T>(
  provider: LlmProvider,
  prompt: string,
  parse: (raw: string) => T,
  opts: CompleteOptions & { retries?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, 1 + (opts.retries ?? DEFAULT_RETRIES));
  let lastRaw: string | undefined;
  let lastError: ClaudeError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptPrompt =
      attempt === 1 ? prompt : `${prompt}\n\n${correctiveSuffix(attempt)}`;
    const raw = await provider.complete(attemptPrompt, opts);
    lastRaw = raw;
    try {
      return parse(raw);
    } catch (error) {
      if (error instanceof ClaudeError) {
        lastError = error;
        continue;
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
