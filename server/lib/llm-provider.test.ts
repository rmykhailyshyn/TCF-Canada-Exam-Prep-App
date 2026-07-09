import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeError,
  type LlmProvider,
  completeJson,
  createApiProvider,
  extractJsonObject,
  providerLabel,
  resolveLlmConfig,
} from "./llm-provider";

// spec: docs/specs/llm-provider.md §Behaviour.1–7; Acceptance criteria — the provider seam is
// exercised here with a stubbed `fetch` (no real network call) and plain in-memory config objects.

describe("resolveLlmConfig", () => {
  it("defaults to the cli provider when LLM_PROVIDER is unset", () => {
    expect(resolveLlmConfig({})).toEqual({ provider: "cli", bin: "claude" });
  });

  it("defaults to the cli provider for an unrecognised LLM_PROVIDER value", () => {
    expect(resolveLlmConfig({ LLM_PROVIDER: "ollama" })).toEqual({
      provider: "cli",
      bin: "claude",
    });
  });

  it("reads CLAUDE_CLI_BIN / CLAUDE_CLI_MODEL for the cli provider", () => {
    expect(
      resolveLlmConfig({
        CLAUDE_CLI_BIN: "/usr/local/bin/claude",
        CLAUDE_CLI_MODEL: "claude-opus-4-8",
      }),
    ).toEqual({
      provider: "cli",
      bin: "/usr/local/bin/claude",
      model: "claude-opus-4-8",
    });
  });

  it("resolves the api provider with required + optional vars", () => {
    expect(
      resolveLlmConfig({
        LLM_PROVIDER: "api",
        ANTHROPIC_API_KEY: "sk-ant-test",
        CLAUDE_API_MODEL: "claude-opus-4-8",
        CLAUDE_API_BASE_URL: "https://example.test",
        CLAUDE_API_MAX_TOKENS: "1234",
      }),
    ).toEqual({
      provider: "api",
      apiKey: "sk-ant-test",
      model: "claude-opus-4-8",
      baseUrl: "https://example.test",
      maxTokens: 1234,
    });
  });

  it("applies defaults for optional api vars", () => {
    const config = resolveLlmConfig({
      LLM_PROVIDER: "api",
      ANTHROPIC_API_KEY: "sk-ant-test",
      CLAUDE_API_MODEL: "claude-opus-4-8",
    });
    expect(config).toMatchObject({
      provider: "api",
      baseUrl: "https://api.anthropic.com",
      maxTokens: 4096,
    });
  });

  it("throws when LLM_PROVIDER=api and ANTHROPIC_API_KEY is missing", () => {
    expect(() =>
      resolveLlmConfig({ LLM_PROVIDER: "api", CLAUDE_API_MODEL: "m" }),
    ).toThrow(ClaudeError);
  });

  it("throws when LLM_PROVIDER=api and CLAUDE_API_MODEL is missing", () => {
    expect(() =>
      resolveLlmConfig({ LLM_PROVIDER: "api", ANTHROPIC_API_KEY: "k" }),
    ).toThrow(ClaudeError);
  });
});

describe("providerLabel", () => {
  it("labels the cli provider without a model", () => {
    expect(providerLabel({ provider: "cli", bin: "claude" })).toBe(
      "claude-cli",
    );
  });

  it("labels the cli provider with a model", () => {
    expect(
      providerLabel({
        provider: "cli",
        bin: "claude",
        model: "claude-opus-4-8",
      }),
    ).toBe("claude-cli/claude-opus-4-8");
  });

  it("labels the api provider", () => {
    expect(
      providerLabel({
        provider: "api",
        apiKey: "k",
        model: "claude-opus-4-8",
        baseUrl: "https://api.anthropic.com",
        maxTokens: 4096,
      }),
    ).toBe("claude-api/claude-opus-4-8");
  });
});

describe("createApiProvider", () => {
  const config = {
    provider: "api" as const,
    apiKey: "sk-ant-test",
    model: "claude-opus-4-8",
    baseUrl: "https://api.anthropic.com",
    maxTokens: 4096,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("posts to {baseUrl}/v1/messages with the model/max_tokens/messages shape", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ content: [{ type: "text", text: "hello" }] }),
    );
    const provider = createApiProvider(config);
    const result = await provider.complete("say hi", { systemPrompt: null });

    expect(result).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBeTruthy();
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      system?: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-opus-4-8");
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBeUndefined();
    expect(body.messages).toEqual([{ role: "user", content: "say hi" }]);
  });

  it("concatenates multiple text content blocks", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        content: [
          { type: "text", text: "part one " },
          { type: "text", text: "part two" },
        ],
      }),
    );
    const provider = createApiProvider(config);
    expect(await provider.complete("p")).toBe("part one part two");
  });

  it("includes a system field built from the default grounding + jsonSchema", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ content: [{ type: "text", text: "{}" }] }),
    );
    const provider = createApiProvider(config);
    await provider.complete("p", { jsonSchema: { type: "object" } });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as { system?: string };
    expect(body.system).toContain("JSON-only API");
    expect(body.system).toContain('"type":"object"');
  });

  it("throws ClaudeError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
    const provider = createApiProvider(config);
    await expect(provider.complete("p")).rejects.toThrow(ClaudeError);
    await expect(provider.complete("p")).rejects.toThrow(/429/);
  });

  it("throws ClaudeError on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const provider = createApiProvider(config);
    await expect(provider.complete("p")).rejects.toThrow(ClaudeError);
    await expect(provider.complete("p")).rejects.toThrow(/network down/);
  });

  it("throws ClaudeError when the response has no text content", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ content: [] }));
    const provider = createApiProvider(config);
    await expect(provider.complete("p")).rejects.toThrow(ClaudeError);
  });

  it("throws ClaudeError when the response body is not valid JSON", async () => {
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    const provider = createApiProvider(config);
    await expect(provider.complete("p")).rejects.toThrow(ClaudeError);
  });
});

describe("completeJson", () => {
  const parseValue = (raw: string): { value: number } =>
    JSON.parse(extractJsonObject(raw)) as { value: number };

  function fakeProvider(complete: LlmProvider["complete"]): LlmProvider {
    return { complete };
  }

  it("retries a parse failure and succeeds on a later attempt", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json")
      .mockResolvedValueOnce('{"value":42}');
    const result = await completeJson(
      fakeProvider(complete),
      "do it",
      parseValue,
    );
    expect(result).toEqual({ value: 42 });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0]).toContain("could not be parsed as JSON");
  });

  it("throws after exhausting retries, surfacing the truncated raw output", async () => {
    const complete = vi.fn().mockResolvedValue("absolutely not JSON");
    await expect(
      completeJson(fakeProvider(complete), "p", parseValue, { retries: 1 }),
    ).rejects.toThrow(/Raw model output: absolutely not JSON/);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("does not retry a complete() failure (fails fast)", async () => {
    const complete = vi.fn().mockRejectedValue(new ClaudeError("boom"));
    await expect(
      completeJson(fakeProvider(complete), "p", parseValue, { retries: 5 }),
    ).rejects.toThrow("boom");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
