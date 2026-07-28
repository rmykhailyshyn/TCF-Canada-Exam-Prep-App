import { vi } from "vitest";
import type { LlmConfig, LlmProvider } from "../lib/llm-provider";
import type { MediaStore } from "../runtime/media-store";

// Shared in-memory doubles for the runtime abstractions the services take as parameters, so DB-backed
// suites never touch the filesystem or the network. Extracted from the inline helpers in
// server/routes/practice-routes.test.ts.

export type FakeMediaStore = MediaStore & {
  keys: () => string[];
  bytes: (key: string) => Uint8Array | undefined;
};

/** A `MediaStore` backed by a Map — put/stat/getRange/exists/delete with no filesystem. */
export function fakeMediaStore(): FakeMediaStore {
  const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    keys: () => [...store.keys()],
    bytes: (key) => store.get(key)?.bytes,
    async stat(key) {
      const v = store.get(key);
      return v ? { size: v.bytes.byteLength, contentType: v.contentType } : null;
    },
    async getRange(key, range) {
      const v = store.get(key);
      const all = v?.bytes ?? new Uint8Array();
      const slice = range ? all.slice(range.start, range.end + 1) : all;
      return new ReadableStream({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
    },
    async put(key, bytes, contentType) {
      store.set(key, { bytes, contentType });
    },
    async exists(key) {
      return store.has(key);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/**
 * A stub `LlmProvider` (no real fetch) resolving fixed replies in order, so scoring-enabled tests
 * exercise the real service + its `completeJson` retry wrapper with no network dependency. The last
 * reply repeats once the list is exhausted. spec: docs/specs/llm-provider.md §Behaviour.4, 6
 */
export function stubLlm(...replies: string[]): {
  provider: LlmProvider;
  config: LlmConfig;
} {
  const config: LlmConfig = {
    provider: "api",
    apiKey: "sk-ant-test",
    model: "claude-opus-4-8",
    baseUrl: "https://api.anthropic.com",
    maxTokens: 4096,
  };
  let i = 0;
  const provider: LlmProvider = {
    complete: vi.fn(async () => replies[Math.min(i++, replies.length - 1)]),
  };
  return { provider, config };
}
