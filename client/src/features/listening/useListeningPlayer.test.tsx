// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../../lib/api";
import { activeSegmentIndex, useListeningPlayer } from "./useListeningPlayer";

// spec: docs/specs/listening-player.md §Behaviour.3, 4, 7, 9, 11
// The hook attaches listeners to an <audio> element the component owns. jsdom implements neither
// play() nor pause() nor real media loading, so a minimal fake element is driven directly: it records
// play/pause and dispatches the same events a real element would.

const SEGMENTS: TranscriptSegment[] = [
  { sequence: 0, text: "Bonjour.", startMs: 0, endMs: 1000 },
  { sequence: 1, text: "Comment allez-vous ?", startMs: 1000, endMs: 2500 },
  { sequence: 2, text: "Au revoir.", startMs: 2500, endMs: 4000 },
];

afterEach(() => {
  // Auto-cleanup is off without vitest `globals`, so unmount explicitly between tests.
  cleanup();
});

describe("activeSegmentIndex", () => {
  // spec: §Behaviour.7 — active when `start_ms <= currentMs < next start_ms`.
  it("returns -1 before the first segment starts", () => {
    expect(activeSegmentIndex(SEGMENTS.slice(1), 0)).toBe(-1);
  });

  it("marks the segment whose window contains the position", () => {
    expect(activeSegmentIndex(SEGMENTS, 0)).toBe(0);
    expect(activeSegmentIndex(SEGMENTS, 999)).toBe(0);
    expect(activeSegmentIndex(SEGMENTS, 1000)).toBe(1);
    expect(activeSegmentIndex(SEGMENTS, 2499)).toBe(1);
    expect(activeSegmentIndex(SEGMENTS, 2500)).toBe(2);
  });

  it("keeps the last segment active past its end", () => {
    expect(activeSegmentIndex(SEGMENTS, 99_999)).toBe(2);
  });

  it("returns -1 for an empty transcript", () => {
    expect(activeSegmentIndex([], 500)).toBe(-1);
  });
});

type FakeAudio = HTMLAudioElement & { playCalls: number; pauseCalls: number };

/** A stand-in for HTMLAudioElement covering only what the hook touches. */
function fakeAudio(): FakeAudio {
  const el = document.createElement("audio") as FakeAudio;
  el.playCalls = 0;
  el.pauseCalls = 0;
  Object.defineProperty(el, "paused", { value: true, writable: true });
  Object.defineProperty(el, "duration", { value: 4, writable: true });
  el.play = vi.fn(() => {
    el.playCalls += 1;
    return Promise.resolve();
  });
  el.pause = vi.fn(() => {
    el.pauseCalls += 1;
  });
  return el;
}

describe("useListeningPlayer", () => {
  let el: FakeAudio;
  let ref: { current: HTMLAudioElement | null };

  beforeEach(() => {
    el = fakeAudio();
    ref = { current: el };
  });

  function render(volume = 1) {
    return renderHook(() =>
      useListeningPlayer(ref as RefObject<HTMLAudioElement>, SEGMENTS, volume),
    );
  }

  it("starts not ready, not playing and at position zero", () => {
    const { result } = render();
    expect(result.current).toMatchObject({
      ready: false,
      error: false,
      isPlaying: false,
      currentMs: 0,
      durationMs: 0,
      activeIndex: 0,
    });
  });

  it("becomes ready on canplay", () => {
    const { result } = render();
    act(() => {
      el.dispatchEvent(new Event("canplay"));
    });
    expect(result.current.ready).toBe(true);
  });

  // Without this the play button would stay disabled forever when the MP3 404s.
  it("flags an error when the element fails to load its source", () => {
    const { result } = render();
    act(() => {
      el.dispatchEvent(new Event("error"));
    });
    expect(result.current.error).toBe(true);
    expect(result.current.ready).toBe(false);
  });

  it("reads the duration from loadedmetadata", () => {
    const { result } = render();
    act(() => {
      el.dispatchEvent(new Event("loadedmetadata"));
    });
    expect(result.current.durationMs).toBe(4000);
  });

  it("tracks the position and the active segment as playback advances", () => {
    const { result } = render();
    act(() => {
      el.currentTime = 1.2;
      el.dispatchEvent(new Event("timeupdate"));
    });
    expect(result.current.currentMs).toBeCloseTo(1200);
    expect(result.current.activeIndex).toBe(1);
  });

  it("mirrors the element's play and pause events", () => {
    const { result } = render();
    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    expect(result.current.isPlaying).toBe(true);
    act(() => {
      el.dispatchEvent(new Event("pause"));
    });
    expect(result.current.isPlaying).toBe(false);
  });

  // spec: §Behaviour.11 — at the end, stop and reset to paused at 0.
  it("rewinds to the start when playback ends", () => {
    const { result } = render();
    act(() => {
      el.currentTime = 3.9;
      el.dispatchEvent(new Event("timeupdate"));
      el.dispatchEvent(new Event("play"));
    });
    act(() => {
      el.dispatchEvent(new Event("ended"));
    });
    expect(el.currentTime).toBe(0);
    expect(result.current.currentMs).toBe(0);
    expect(result.current.isPlaying).toBe(false);
  });

  // spec: §Behaviour.4 — the session's volume is applied to the element.
  it("applies the supplied volume", () => {
    render(0.25);
    expect(el.volume).toBeCloseTo(0.25);
  });

  it("plays and pauses through the controls", () => {
    const { result } = render();
    act(() => {
      result.current.play();
    });
    expect(el.playCalls).toBe(1);
    act(() => {
      result.current.pause();
    });
    expect(el.pauseCalls).toBe(1);
  });

  it("toggle plays when paused and pauses when playing", () => {
    const { result } = render();
    act(() => {
      result.current.toggle();
    });
    expect(el.playCalls).toBe(1);

    Object.defineProperty(el, "paused", { value: false, writable: true });
    act(() => {
      result.current.toggle();
    });
    expect(el.pauseCalls).toBe(1);
  });

  // spec: §Behaviour.3 — seek to any position; negatives clamp to the start.
  it("seeks to a position and clamps below zero", () => {
    const { result } = render();
    act(() => {
      result.current.seekMs(1500);
    });
    expect(el.currentTime).toBeCloseTo(1.5);
    expect(result.current.currentMs).toBe(1500);

    act(() => {
      result.current.seekMs(-500);
    });
    expect(el.currentTime).toBe(0);
    expect(result.current.currentMs).toBe(0);
  });

  // spec: §Behaviour.9 — clicking a segment seeks there and starts playing.
  it("seeks to a segment and plays", () => {
    const { result } = render();
    act(() => {
      result.current.seekToSegment(2);
    });
    expect(el.currentTime).toBeCloseTo(2.5);
    expect(result.current.currentMs).toBe(2500);
    expect(result.current.activeIndex).toBe(2);
    expect(el.playCalls).toBe(1);
  });

  it("ignores a seek to a segment index that does not exist", () => {
    const { result } = render();
    act(() => {
      result.current.seekToSegment(99);
    });
    expect(el.playCalls).toBe(0);
    expect(result.current.currentMs).toBe(0);
  });

  // The component renders before its ref is attached; the controls must be safe no-ops until then.
  it("is inert while the audio ref is still null", () => {
    ref.current = null;
    const { result } = render();
    act(() => {
      result.current.play();
      result.current.pause();
      result.current.toggle();
      result.current.seekMs(1000);
    });
    expect(result.current.currentMs).toBe(0);
    expect(result.current.ready).toBe(false);
  });
});
