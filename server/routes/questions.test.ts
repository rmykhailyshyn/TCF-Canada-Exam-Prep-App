import { describe, expect, it } from 'vitest';
import { parseRange } from './questions';

// spec: docs/specs/listening-player.md §API contract — the audio route must support range
// requests so the <audio> element can seek.

describe('parseRange', () => {
  it('returns null when there is no Range header (serve the whole file)', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
  });

  it('resolves an open-ended range to the rest of the file', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('resolves a closed range', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('clamps an end past the file size to the last byte', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('returns null for an unsatisfiable or malformed range', () => {
    expect(parseRange('bytes=2000-3000', 1000)).toBeNull();
    expect(parseRange('bytes=600-500', 1000)).toBeNull();
    expect(parseRange('seconds=0-1', 1000)).toBeNull();
  });
});
