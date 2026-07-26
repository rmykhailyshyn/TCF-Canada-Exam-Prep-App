import { runClaude } from "./claude-cli";
import {
  type LlmConfig,
  type LlmProvider,
  createApiProvider,
  resolveLlmConfig,
} from "./llm-provider";

// spec: docs/specs/llm-provider.md §Behaviour.1–4
// The Node-only half of the provider factory. Only this module touches `runClaude` (child_process),
// so it must never be imported by anything reachable from the portable core or the Worker entry — the
// Node entry (server/index.ts) and the enrichment script (scripts/enrich.ts) are its only callers.

// spec: docs/specs/llm-provider.md §Behaviour.2, 4 — the CLI provider wraps the existing `runClaude`
// (synchronous child_process spawn) with no behaviour change; grounding opts pass straight through.
function createCliProvider(
  config: Extract<LlmConfig, { provider: "cli" }>,
): LlmProvider {
  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- async to satisfy the LlmProvider.complete Promise contract; the CLI provider wraps the synchronous runClaude spawn with no behaviour change.
    async complete(prompt, opts = {}) {
      return runClaude(prompt, {
        bin: config.bin,
        model: opts.model ?? config.model,
        timeoutMs: opts.timeoutMs,
        jsonSchema: opts.jsonSchema,
        systemPrompt: opts.systemPrompt,
      });
    },
  };
}

// spec: docs/specs/llm-provider.md §Behaviour.1 — the config-driven factory Node call sites use:
// resolves LLM_PROVIDER from the environment and returns whichever provider is active, plus its
// resolved config (needed by callers for `generated_by` provenance via `providerLabel`).
export function createLlmProviderForNode(
  env: Record<string, string | undefined> = process.env,
): { provider: LlmProvider; config: LlmConfig } {
  const config = resolveLlmConfig(env);
  const provider =
    config.provider === "cli"
      ? createCliProvider(config)
      : createApiProvider(config);
  return { provider, config };
}
