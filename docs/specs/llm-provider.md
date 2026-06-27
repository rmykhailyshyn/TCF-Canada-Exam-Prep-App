# Spec: Selectable LLM provider (local CLI default + Claude HTTP API)

## Status

draft

> Milestone 17. A single configurable seam for every Claude call in the app. Today all LLM access
> goes through one synchronous primitive (`runClaude` in `server/lib/claude-cli.ts`) that shells out
> to the local `claude` binary. This spec adds a second backend — the Claude HTTP API (Messages API
> via native `fetch`) — selected by configuration, with explicit per-provider model selection. The
> local CLI stays the zero-config default. Because the API path needs no local binary, it also lets
> the deployed Cloudflare Worker score Writing/Speaking online when an API key is configured.

## Goal

Decouple the app's LLM access from the requirement that the host machine have the `claude` CLI
installed and authenticated. A user should be able to keep the current behaviour with no config
(local CLI), or set a couple of `.env` values to route the exact same prompts through the Claude HTTP
API against a model they choose. The change is invisible at the prompt/output level — only the
transport and the configured model differ — and it unlocks AI scoring on the online (Worker) instance,
which has no local binary.

## Scope

- In scope:
  - A **provider seam** in `server/lib/` exposing one async operation,
    `complete(prompt: string, opts?) => Promise<string>`, that returns the model's reply text.
  - A **CLI provider** that wraps the existing `runClaude` (no behaviour change; default).
  - An **API provider** that calls the Claude Messages API with the runtime's built-in `fetch`
    (no new dependency; runs in both Node and the Workers runtime).
  - A **config-driven factory** that picks the provider from `.env` (and Worker secrets), defaulting
    to the CLI.
  - Routing **all three LLM call sites** through the seam: Writing scoring + correction
    (`server/services/writingEvaluation.ts`), Speaking scoring + correction
    (`server/services/speakingEvaluation.ts`), and reading/listening enrichment
    (`scripts/lib/claude.ts` / `scripts/enrich.ts`).
  - Recording the backend + model in the existing `generated_by` provenance values.
  - Enabling `capabilities.aiScoring` and mounting the writing/speaking scoring + correction routes
    on the Worker **when an API key is bound**.
- Out of scope:
  - Changing any prompt text or the JSON output contracts — the existing pure prompt builders and the
    `extractJsonObject` / `parse*Response` parsers are reused verbatim.
  - Replacing Whisper transcription. Audio → transcript stays local-only (Apple Silicon/macOS); the
    Worker does not transcribe.
  - Streaming responses, provider auto-fallback/retries-across-providers, multi-turn conversations,
    or per-call provider overrides from the UI.
  - Any client/UI change beyond what M16 already covers for capability gating.

## Behaviour

### Provider selection & configuration

1. The active provider is chosen by `LLM_PROVIDER` (`cli` (default) | `api`). When unset or set to an
   unrecognised value it resolves to `cli`, so an existing checkout behaves exactly as it does today.
2. The **CLI provider** reads the existing keys unchanged: `CLAUDE_CLI_BIN` (default `claude`) and the
   optional `CLAUDE_CLI_MODEL` (passed as `--model`). No API key is read; the CLI manages its own auth.
   The CLI path also passes `--safe-mode` on every call (see `llm-enrichment.md` §Behaviour.3d) to run
   without project customizations; the M17 seam must preserve this when wrapping `runClaude`.
3. The **API provider** reads: `ANTHROPIC_API_KEY` (required — its absence is a configuration error),
   `CLAUDE_API_MODEL` (the selected model, e.g. `claude-opus-4-8`), and the optional
   `CLAUDE_API_BASE_URL` (default `https://api.anthropic.com`) and `CLAUDE_API_MAX_TOKENS`
   (a documented default applies when unset).

### Invocation & error handling

4. `complete()` is asynchronous. The CLI provider wraps the synchronous `runClaude` and resolves with
   its returned text. The API provider issues a single `POST {baseUrl}/v1/messages` with a one-shot
   user message containing the prompt, the configured model and `max_tokens`, and the required
   `x-api-key` / `anthropic-version` headers; it concatenates the response's text content blocks into
   one string.
5. Every failure mode — CLI not found / non-zero exit (existing), and for the API path a non-2xx
   response, a network error, or a response missing text content — surfaces as the existing
   `ClaudeError` type. No new error codes are introduced: server call sites keep mapping `ClaudeError`
   to `EVALUATION_FAILED` / `CORRECTION_FAILED`, and the enrichment script keeps its skip-and-continue
   behaviour.
6. The three call sites become async: `scoreWithClaude`, `correctWithClaude` (both services) and
   `generateExplanation` (enrichment) return promises. The server callers (`writing-node.ts`,
   `speaking-node.ts`) already run inside an `async submitResponse` and simply `await`; the enrichment
   script awaits once per question inside its existing loop. Output parsing/validation is unchanged.

### Provenance

7. The value persisted to `generated_by` records the backend and model: `claude-cli` or
   `claude-cli/<model>` for the CLI path (unchanged), and `claude-api/<model>` for the API path. This
   applies to `writing_evaluations`, `speaking_evaluations`, and `explanations` rows.

### Cloudflare Worker (online scoring)

8. When `ANTHROPIC_API_KEY` is bound to the Worker (as a secret), the Worker uses the API provider,
   reports `capabilities.aiScoring: true` from `GET /api/health`, and mounts the writing/speaking
   **scoring + correction** routes. When no key is bound the Worker is unchanged from M15: `aiScoring`
   stays `false` and those routes are not mounted.
9. Imports, enrichment, and transcription remain **unavailable** on the Worker regardless of the API
   key — they require local binaries and a filesystem. `capabilities.transcription` stays `false`, so
   online Speaking scoring is only possible from an **already-present transcript**; in-browser
   recording → Whisper transcription remains a local/full-runtime capability.

## Data model changes

None to table shape. The documented value space of the existing `generated_by` columns widens to add
the API backend. No migration is required (the columns are already free-form `text`).

```
-- spec: docs/specs/llm-provider.md §Behaviour.7 — generated_by provenance value space
writing_evaluations.generated_by   -- 'claude-cli' | 'claude-cli/<model>' | 'claude-api/<model>'
speaking_evaluations.generated_by  -- 'claude-cli' | 'claude-cli/<model>' | 'claude-api/<model>'
explanations.generated_by          -- 'claude-cli' | 'claude-cli/<model>' | 'claude-api/<model>'
```

## API contract

No new HTTP routes. Two internal contracts are introduced, plus one observable change to the health
capabilities.

**Internal provider seam** (consumed by the evaluation services + enrichment script):

```typescript
// spec: docs/specs/llm-provider.md §Behaviour.4
type LlmProvider = {
  complete(
    prompt: string,
    // NOTE (2026-06-27): the CLI path gained grounding opts — `jsonSchema?` (→ `--json-schema`),
    // `systemPrompt?` (→ `--append-system-prompt`), and a bounded retry — see llm-enrichment.md
    // §Grounding & reliability. The seam must thread these through `complete()` so the API provider
    // can translate them (schema → tool/`response_format`-style structured output; systemPrompt → the
    // Messages `system` param) and own its own retry. M17 design must absorb this, not regress it.
    opts?: { model?: string; timeoutMs?: number },
  ): Promise<string>;
};

// Config the factory reads from the environment. spec: §Behaviour.1–3
type LlmConfig =
  | { provider: "cli"; bin: string; model?: string }
  | {
      provider: "api";
      apiKey: string;
      model: string;
      baseUrl: string;
      maxTokens: number;
    };
```

**Outbound Claude Messages API call** (API provider only). `POST {baseUrl}/v1/messages` with headers
`x-api-key: <ANTHROPIC_API_KEY>`, `anthropic-version: <pinned version>`, `content-type: application/json`:

```jsonc
// request
{ "model": "<CLAUDE_API_MODEL>", "max_tokens": <n>,
  "messages": [{ "role": "user", "content": "<prompt>" }] }
// response (text blocks concatenated into the returned string)
{ "content": [{ "type": "text", "text": "..." }], "stop_reason": "end_turn" }
```

**Health.** `GET /api/health` `capabilities.aiScoring` is `true` on a Worker with an API key bound
(otherwise `false`); on the Node runtime it remains `true` as today.

No new error codes; failures reuse `ClaudeError` → `EVALUATION_FAILED` / `CORRECTION_FAILED`
(server) or a skipped question (enrichment).

## Acceptance criteria

- [ ] With no new config, every call site uses the CLI provider and persists `claude-cli` /
      `claude-cli/<model>` exactly as before — no observable change. (Behaviour.1, 2, 7)
- [ ] `LLM_PROVIDER=api` with `ANTHROPIC_API_KEY` + `CLAUDE_API_MODEL` routes calls through `fetch` to
      `{baseUrl}/v1/messages` and persists `claude-api/<model>`. (Behaviour.3, 4, 7)
- [ ] `LLM_PROVIDER=api` with no `ANTHROPIC_API_KEY` raises `ClaudeError`, which the server maps to
      `EVALUATION_FAILED` and the enrichment script treats as skip-and-continue. (Behaviour.5)
- [ ] An API non-2xx / network error / content-less response each surface as `ClaudeError`; no new
      error code is added. (Behaviour.5)
- [ ] The pure prompt builders and `parse*Response` helpers are unchanged and still unit-tested with
      no process spawn and no network. (Scope: out of scope — prompts/contracts)
- [ ] The API provider has a unit test driven by a stubbed `fetch` (success + failure shapes) that
      never makes a real network call. (Behaviour.4, 5)
- [ ] The three call sites are async and their server callers `await` them with the same error
      mapping; the enrichment loop awaits per question. (Behaviour.6)
- [ ] On the Worker, `GET /api/health` reports `aiScoring: true` and the scoring/correction routes are
      mounted **only** when `ANTHROPIC_API_KEY` is bound; otherwise both stay as M15. (Behaviour.8)
- [ ] `capabilities.transcription` stays `false` on the Worker; online Speaking scoring works only
      from an existing transcript. (Behaviour.9)

## Open questions

- **API key env name.** `ANTHROPIC_API_KEY` (the SDK/convention) vs a project-local `CLAUDE_API_KEY`.
  Default: `ANTHROPIC_API_KEY`.
- **Model var unification.** Whether to keep separate `CLAUDE_CLI_MODEL` / `CLAUDE_API_MODEL` or fold
  into a single `CLAUDE_MODEL` since the provider is unambiguous. Default: keep separate (least
  surprising for existing CLI users).
- **Default `max_tokens`.** A concrete default for `CLAUDE_API_MAX_TOKENS` large enough for the
  longest correction reply (TBD at implementation).
- **API timeout / retry policy.** Whether the API provider retries transient 429/5xx, and the request
  timeout. Default: a single attempt with a bounded timeout mirroring the CLI's 180s, no cross-provider
  fallback.
- **Worker Speaking scoring.** Whether to expose transcript-only Speaking scoring on the Worker in
  M17, or defer it until online transcription has an answer. Default: defer; ship Writing online
  scoring first.

## Revision history

- 2026-06-26: Initial draft (Milestone 17).
- 2026-06-27: Annotated the `complete()` seam — the CLI path gained grounding opts (`jsonSchema`,
  `systemPrompt`) + a bounded retry (see `llm-enrichment.md` §Grounding & reliability). M17 must thread
  these through the seam and translate them for the API provider rather than regressing them.
