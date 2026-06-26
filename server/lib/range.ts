// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio (range support)
// Parses an HTTP `Range: bytes=start-end` header against a known file size. Returns null for an
// absent/unsatisfiable header (caller serves the whole file), or the resolved byte window.
// Moved here from routes/questions.ts in Milestone 14 so the framework-agnostic route helpers
// (audio, passage-image, speaking recording) and the unit test share one implementation.
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
  let end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end >= size) end = size - 1;
  if (start > end || start < 0) return null;
  return { start, end };
}
