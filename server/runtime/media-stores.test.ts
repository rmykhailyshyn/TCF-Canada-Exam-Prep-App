import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentTypeForKey } from "./content-type";
import { NodeMediaStore } from "./node-media-store";

// spec: docs/specs/server-runtime.md §Behaviour.6; §Runtime abstractions
// The shared extension→content-type mapping and the Node/filesystem MediaStore, driven against a
// real temp MEDIA_DIR. Its R2 counterpart must behave identically for the serve layer; because
// r2-media-store.ts is typed in the separate Workers program (server/tsconfig.worker.json), its
// matching cases live in ./r2-media-store.test.ts.

async function drain(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

describe("contentTypeForKey", () => {
  it.each([
    ["listening/q1.mp3", "audio/mpeg"],
    ["reading/p.png", "image/png"],
    ["reading/p.jpg", "image/jpeg"],
    ["reading/p.jpeg", "image/jpeg"],
    ["speaking/take.webm", "audio/webm"],
    ["speaking/take.ogg", "audio/ogg"],
    ["speaking/take.m4a", "audio/mp4"],
    ["speaking/take.mp4", "audio/mp4"],
    ["speaking/take.wav", "audio/wav"],
  ])("maps %s to %s", (key, expected) => {
    expect(contentTypeForKey(key)).toBe(expected);
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeForKey("reading/P.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for an unknown or absent extension", () => {
    expect(contentTypeForKey("notes.txt")).toBe("application/octet-stream");
    expect(contentTypeForKey("no-extension")).toBe("application/octet-stream");
  });
});

describe("NodeMediaStore", () => {
  let dir: string;
  let store: NodeMediaStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tcf-media-"));
    vi.stubEnv("MEDIA_DIR", dir);
    store = new NodeMediaStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null from stat for a key that does not exist", async () => {
    await expect(store.stat("listening/missing.mp3")).resolves.toBeNull();
  });

  it("reports false from exists for an absent key", async () => {
    await expect(store.exists("listening/missing.mp3")).resolves.toBe(false);
  });

  // put creates intermediate folders — the section subfolder may not exist yet.
  it("persists bytes under a nested key and reports size + content type", async () => {
    await store.put("speaking/1/take.webm", new Uint8Array(12), "audio/webm");
    await expect(store.stat("speaking/1/take.webm")).resolves.toEqual({
      size: 12,
      contentType: "audio/webm",
    });
    await expect(store.exists("speaking/1/take.webm")).resolves.toBe(true);
    expect(readFileSync(join(dir, "speaking/1/take.webm")).byteLength).toBe(12);
  });

  it("streams the whole object when no range is given", async () => {
    await store.put("a.bin", Uint8Array.from([1, 2, 3, 4, 5]), "x");
    const bytes = await drain(await store.getRange("a.bin"));
    expect([...bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  // The range is INCLUSIVE at both ends, matching the HTTP Range semantics serveMedia relies on.
  it("streams an inclusive byte window", async () => {
    await store.put("a.bin", Uint8Array.from([0, 1, 2, 3, 4, 5, 6]), "x");
    const bytes = await drain(await store.getRange("a.bin", { start: 2, end: 4 }));
    expect([...bytes]).toEqual([2, 3, 4]);
  });

  it("deletes a key and no-ops when it is already absent", async () => {
    await store.put("gone.bin", new Uint8Array(4), "x");
    await store.delete("gone.bin");
    await expect(store.exists("gone.bin")).resolves.toBe(false);
    await expect(store.delete("gone.bin")).resolves.toBeUndefined();
  });

  // Legacy rows (pre media-path migration) store absolute paths; those must pass through unchanged.
  it("resolves an absolute legacy key outside MEDIA_DIR", async () => {
    const outside = mkdtempSync(join(tmpdir(), "tcf-legacy-"));
    const abs = join(outside, "legacy.mp3");
    writeFileSync(abs, new Uint8Array(9));
    try {
      await expect(store.stat(abs)).resolves.toEqual({
        size: 9,
        contentType: "audio/mpeg",
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
