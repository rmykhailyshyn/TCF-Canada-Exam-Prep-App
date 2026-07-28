import { describe, expect, it } from "vitest";
import { R2MediaStore } from "./r2-media-store";

// spec: docs/specs/cloud-deployment.md §Scope (R2 MediaStore); §Behaviour.6
// The R2 MediaStore must behave identically to the Node/filesystem one for the serve layer: same
// content-type derivation, same inclusive byte-window semantics, same null/absent handling (the
// matching Node cases are in ./media-stores.test.ts).
//
// This file lives in the WORKERS TypeScript program (server/tsconfig.worker.json), alongside
// worker.test.ts and r2-media-store.ts itself — importing the R2 store into the Node program would
// pull @cloudflare/workers-types' globals in and clash with @types/node's ReadableStream.

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

type Stored = { bytes: Uint8Array; contentType?: string };

/** Minimal stand-in for the R2Bucket binding surface the store actually uses. */
function fakeBucket() {
  const objects = new Map<string, Stored>();
  return {
    objects,
    async head(key: string) {
      const o = objects.get(key);
      return o ? { size: o.bytes.byteLength } : null;
    },
    async get(
      key: string,
      opts?: { range: { offset: number; length: number } },
    ) {
      const o = objects.get(key);
      if (!o) return null;
      const slice = opts
        ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : o.bytes;
      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(slice);
            controller.close();
          },
        }),
      };
    },
    async put(
      key: string,
      bytes: Uint8Array,
      opts?: { httpMetadata: { contentType: string } },
    ) {
      objects.set(key, { bytes, contentType: opts?.httpMetadata.contentType });
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
}

function makeStore() {
  const bucket = fakeBucket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake implements only the R2Bucket subset the store uses; constructing the full binding type is not possible outside the Worker runtime
  return { bucket, store: new R2MediaStore(bucket as any) };
}

describe("R2MediaStore", () => {
  it("returns null from stat for a missing object", async () => {
    const { store } = makeStore();
    await expect(store.stat("listening/none.mp3")).resolves.toBeNull();
  });

  // Parity with Node: R2 stores no usable content type, so it is derived from the key.
  it("derives the content type from the key on stat", async () => {
    const { store } = makeStore();
    await store.put("listening/q1.mp3", new Uint8Array(7), "audio/mpeg");
    await expect(store.stat("listening/q1.mp3")).resolves.toEqual({
      size: 7,
      contentType: "audio/mpeg",
    });
  });

  it("persists the content type as object metadata", async () => {
    const { bucket, store } = makeStore();
    await store.put("speaking/take.webm", new Uint8Array(3), "audio/webm");
    expect(bucket.objects.get("speaking/take.webm")?.contentType).toBe(
      "audio/webm",
    );
  });

  it("streams the whole object when no range is given", async () => {
    const { store } = makeStore();
    await store.put("a.bin", Uint8Array.from([9, 8, 7]), "x");
    expect([...(await drain(await store.getRange("a.bin")))]).toEqual([9, 8, 7]);
  });

  // serveMedia passes an inclusive {start,end}; R2 wants {offset,length} — the conversion must match
  // the Node store byte for byte.
  it("converts an inclusive window to R2's offset/length", async () => {
    const { store } = makeStore();
    await store.put("a.bin", Uint8Array.from([0, 1, 2, 3, 4, 5, 6]), "x");
    const bytes = await drain(
      await store.getRange("a.bin", { start: 2, end: 4 }),
    );
    expect([...bytes]).toEqual([2, 3, 4]);
  });

  it("throws when the requested object is absent", async () => {
    const { store } = makeStore();
    await expect(store.getRange("nope.bin")).rejects.toThrow(
      "R2 object not found: nope.bin",
    );
  });

  it("reports existence and deletes", async () => {
    const { store } = makeStore();
    await expect(store.exists("x.bin")).resolves.toBe(false);
    await store.put("x.bin", new Uint8Array(1), "x");
    await expect(store.exists("x.bin")).resolves.toBe(true);
    await store.delete("x.bin");
    await expect(store.exists("x.bin")).resolves.toBe(false);
  });
});
