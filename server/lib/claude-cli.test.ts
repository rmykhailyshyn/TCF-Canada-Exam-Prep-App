import { beforeEach, describe, expect, it, vi } from "vitest";

// spec: docs/specs/llm-enrichment.md §Behaviour.3e–3g, 7 — grounding (system prompt + JSON schema),
// bounded parse-failure retries, and raw-output diagnostics. The CLI process is mocked so these tests
// never spawn anything; only the argv-building and retry control flow are exercised.

const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

import {
  ClaudeError,
  JSON_ONLY_SYSTEM_PROMPT,
  extractJsonObject,
  runClaude,
  runClaudeJson,
} from "./claude-cli";

// A successful CLI invocation: a zero exit whose stdout is the `--output-format json` envelope.
function envelope(result: string) {
  return {
    status: 0,
    stdout: JSON.stringify({ is_error: false, result }),
    stderr: "",
    error: undefined,
  };
}

// Parse callback used across the retry tests: the model output must contain a JSON object.
const parseValue = (raw: string): { value: number } =>
  JSON.parse(extractJsonObject(raw)) as { value: number };

function lastArgs(callIndex: number): string[] {
  return spawnSyncMock.mock.calls[callIndex][1] as string[];
}

function promptOf(args: string[]): string {
  return args[args.indexOf("-p") + 1];
}

beforeEach(() => {
  spawnSyncMock.mockReset();
});

describe("runClaude grounding args", () => {
  it("appends the JSON-only system prompt and the JSON schema", () => {
    spawnSyncMock.mockReturnValue(envelope('{"a":1}'));
    const schema = { type: "object", additionalProperties: false };
    runClaude("hello", { jsonSchema: schema });

    const args = lastArgs(0);
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain(JSON_ONLY_SYSTEM_PROMPT);
    expect(args).toContain("--json-schema");
    expect(args).toContain(JSON.stringify(schema));
  });

  it("omits the system prompt when systemPrompt is null, and the schema when absent", () => {
    spawnSyncMock.mockReturnValue(envelope("{}"));
    runClaude("hi", { systemPrompt: null });

    const args = lastArgs(0);
    expect(args).not.toContain("--append-system-prompt");
    expect(args).not.toContain("--json-schema");
  });
});

describe("runClaudeJson retry + diagnostics", () => {
  it("retries a parse failure and succeeds on a later attempt", () => {
    spawnSyncMock
      .mockReturnValueOnce(envelope("Sorry, I can't help with that."))
      .mockReturnValueOnce(envelope('{"value":42}'));

    const result = runClaudeJson("do it", parseValue);

    expect(result).toEqual({ value: 42 });
    expect(spawnSyncMock).toHaveBeenCalledTimes(2);
    // The retry appends a corrective nudge to the prompt.
    expect(promptOf(lastArgs(1))).toContain("could not be parsed as JSON");
  });

  it("throws after exhausting retries, surfacing the truncated raw output", () => {
    spawnSyncMock.mockReturnValue(envelope("absolutely not JSON"));

    expect(() => runClaudeJson("p", parseValue, { retries: 1 })).toThrow(
      /Raw model output: absolutely not JSON/,
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(2); // first attempt + 1 retry
  });

  it("truncates a long raw output and reports the total length", () => {
    spawnSyncMock.mockReturnValue(envelope("x".repeat(600)));

    expect(() => runClaudeJson("p", parseValue, { retries: 0 })).toThrow(
      /\[truncated, 600 chars total\]/,
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(1); // retries: 0 → a single attempt
  });

  it("does not retry a non-zero CLI exit (fails fast)", () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "boom",
      error: undefined,
    });

    expect(() => runClaudeJson("p", parseValue, { retries: 5 })).toThrow(
      ClaudeError,
    );
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });
});
