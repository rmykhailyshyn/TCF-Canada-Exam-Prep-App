import {
  createReadStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { resolveMediaPath } from "../config/env";
import { contentTypeForKey } from "./content-type";
import type { MediaStore } from "./media-store";

// spec: docs/specs/server-runtime.md §Behaviour.6; §Runtime abstractions
// Node/filesystem implementation of MediaStore. Keys are resolved through the existing
// resolveMediaPath() (relative keys join MEDIA_DIR; legacy absolute paths pass through), preserving
// the exact range/streaming semantics the Express routes had. This module is the only MediaStore
// implementation that imports `node:fs`, so it is registered solely by the Node entry and never
// reaches the portable core (the future Worker bundle). The content-type mapping is shared with the
// R2 store via ./content-type.

export class NodeMediaStore implements MediaStore {
  // spec: docs/specs/server-runtime.md §Behaviour.6 — size + contentType for range headers / 416.
  async stat(
    key: string,
  ): Promise<{ size: number; contentType: string } | null> {
    const path = resolveMediaPath(key);
    if (!existsSync(path)) return null;
    return { size: statSync(path).size, contentType: contentTypeForKey(key) };
  }

  // spec: docs/specs/server-runtime.md §Behaviour.6 — range-aware byte streaming (HTTP 206).
  async getRange(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream> {
    const path = resolveMediaPath(key);
    const nodeStream = range
      ? createReadStream(path, { start: range.start, end: range.end })
      : createReadStream(path);
    return Readable.toWeb(nodeStream) as unknown as ReadableStream;
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — persist recording bytes.
  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    // The filesystem store derives content type from the key's extension on read (stat), so the
    // contentType arg is unused here; it is part of the MediaStore contract for stores (R2) that
    // persist it as object metadata.
    void contentType;
    const path = resolveMediaPath(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — presence check (import warnings).
  async exists(key: string): Promise<boolean> {
    return existsSync(resolveMediaPath(key));
  }

  // spec: docs/specs/server-runtime.md §Runtime abstractions — remove a stale recording take.
  async delete(key: string): Promise<void> {
    const path = resolveMediaPath(key);
    if (existsSync(path)) rmSync(path, { force: true });
  }
}
