import { describe, expect, it } from "vitest";
import { WhisperError, parseWhisperJson } from "./whisper";

// spec: docs/specs/listening-import.md §Behaviour.7 — phrase-level (text, start_ms, end_ms),
// ordered by sequence with start_ms <= end_ms.

describe("parseWhisperJson", () => {
  it("converts seconds to ordered ms segments and reports the clip duration", () => {
    const raw = JSON.stringify({
      text: "Bonjour. Comment allez-vous ?",
      segments: [
        { start: 0, end: 1.5, text: " Bonjour." },
        { start: 1.5, end: 3.2, text: "Comment allez-vous ? " },
      ],
    });
    const { segments, durationMs } = parseWhisperJson(raw);
    expect(segments).toEqual([
      { sequence: 1, text: "Bonjour.", startMs: 0, endMs: 1500 },
      { sequence: 2, text: "Comment allez-vous ?", startMs: 1500, endMs: 3200 },
    ]);
    expect(durationMs).toBe(3200);
  });

  it("drops blank segments and renumbers sequence contiguously", () => {
    const raw = JSON.stringify({
      segments: [
        { start: 0, end: 1, text: "Un" },
        { start: 1, end: 2, text: "   " },
        { start: 2, end: 3, text: "Deux" },
      ],
    });
    const { segments } = parseWhisperJson(raw);
    expect(segments.map((s) => s.text)).toEqual(["Un", "Deux"]);
    expect(segments.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("clamps end_ms to be at least start_ms", () => {
    const raw = JSON.stringify({
      segments: [{ start: 2, end: 1.5, text: "oops" }],
    });
    const { segments } = parseWhisperJson(raw);
    expect(segments[0].startMs).toBe(2000);
    expect(segments[0].endMs).toBe(2000);
  });

  it("returns no segments and null duration for an empty transcript", () => {
    expect(parseWhisperJson(JSON.stringify({ segments: [] }))).toEqual({
      segments: [],
      durationMs: null,
    });
  });

  it("throws WhisperError on unparseable JSON", () => {
    expect(() => parseWhisperJson("not json")).toThrow(WhisperError);
  });
});
