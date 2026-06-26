/// <reference types="@cloudflare/workers-types" />
import { contentTypeForKey } from "./content-type";
import type { MediaStore } from "./media-store";

// spec: docs/specs/cloud-deployment.md §Scope (R2 MediaStore); §Behaviour.6
// Cloudflare R2 implementation of the Milestone 14 MediaStore interface. Wraps an R2 bucket binding
// and preserves the exact range/206 streaming semantics the Node/filesystem store has, so audio
// seeking works in the browser against the cloud runtime. The stored key is the same portable path
// the DB carries (relative to MEDIA_DIR locally / an R2 object key in the cloud). This module imports
// nothing from `node:*`, so it stays in the Worker bundle.
export class R2MediaStore implements MediaStore {
  constructor(private readonly bucket: R2Bucket) {}

  // spec: docs/specs/cloud-deployment.md §Behaviour.6 — size + contentType for range headers / 416.
  // R2 derives no content type for us; reuse the shared extension mapping for parity with Node.
  async stat(
    key: string,
  ): Promise<{ size: number; contentType: string } | null> {
    const head = await this.bucket.head(key);
    if (!head) return null;
    return { size: head.size, contentType: contentTypeForKey(key) };
  }

  // spec: docs/specs/cloud-deployment.md §Behaviour.6 — range-aware byte streaming (HTTP 206).
  // R2 takes an { offset, length } window; serveMedia passes inclusive { start, end }.
  async getRange(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream> {
    const object = range
      ? await this.bucket.get(key, {
          range: { offset: range.start, length: range.end - range.start + 1 },
        })
      : await this.bucket.get(key);
    if (!object || !object.body) {
      throw new Error(`R2 object not found: ${key}`);
    }
    return object.body;
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — persist bytes (used by M16 seeding).
  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } });
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — presence check.
  async exists(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) !== null;
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — remove a key (no-op when absent).
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
