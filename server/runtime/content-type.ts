// spec: docs/specs/server-runtime.md §Behaviour.6; docs/specs/cloud-deployment.md §Scope (R2 MediaStore)
// Pure extension→HTTP content-type mapping shared by every MediaStore implementation. Extracted from
// the original inline logic in node-media-store.ts so the R2 store (Milestone 15) derives the same
// content type without importing `node:path` — this module imports nothing from `node:*`, keeping it
// in the portable core / Worker bundle.

// Derive the HTTP content type from a key's extension. Matches the previous inline logic in the
// questions/speaking routes and the Node MediaStore.
export function contentTypeForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  const ext = dot === -1 ? "" : key.slice(dot).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webm":
      return "audio/webm";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
    case ".mp4":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}
