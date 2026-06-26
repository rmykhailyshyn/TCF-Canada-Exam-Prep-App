// spec: docs/specs/server-runtime.md §Behaviour.6; §Runtime abstractions
// Minimal, runtime-agnostic media abstraction for serving and storing audio / images / recordings.
// The Node implementation (node-media-store.ts) wraps the local filesystem under MEDIA_DIR; the
// future Cloudflare Worker implementation (Milestone 15) wraps an R2 bucket. The stored key is the
// portable path the DB carries (relative to MEDIA_DIR / an R2 object key).
//
// This module intentionally imports nothing from `node:*` so it stays in the portable core.
//
// Rule-4 divergence: the approved spec lists `{ getRange, put, exists }`. Implementation needs two
// more methods: `stat` (size + contentType are required to build Content-Range / Content-Length and
// the 416 unsatisfiable-range case before reading bytes) and `delete` (the speaking re-record path
// removes a stale take when its extension changes). Recorded in the spec + revision history.

export interface MediaStore {
  // Metadata for a key (size in bytes + derived contentType), or null when it does not exist.
  stat(key: string): Promise<{ size: number; contentType: string } | null>;
  // A web ReadableStream of the whole object, or the given byte window (inclusive start/end).
  getRange(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream>;
  // Persist bytes under a key, creating intermediate folders as needed.
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  // Whether a key currently exists in the store.
  exists(key: string): Promise<boolean>;
  // Remove a key if present (no-op when absent).
  delete(key: string): Promise<void>;
}
