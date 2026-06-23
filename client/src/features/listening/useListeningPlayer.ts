import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react';
import type { TranscriptSegment } from '../../lib/api';

// spec: docs/specs/listening-player.md §Behaviour
// Drives one MP3 clip: play/pause/seek, a moving active-segment marker synced to playback, and
// click-to-seek. The component owns the <audio> element and passes its ref in; this hook attaches
// the listeners and exposes derived state + controls. Volume is supplied (and lifted to the quiz
// screen) so it persists across questions within a session (Behaviour.4).

export type ListeningPlayer = {
  ready: boolean;
  error: boolean;
  isPlaying: boolean;
  currentMs: number;
  durationMs: number;
  activeIndex: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekMs: (ms: number) => void;
  seekToSegment: (index: number) => void;
};

// spec: docs/specs/listening-player.md §Behaviour.7 — the active segment satisfies
// `start_ms <= currentTime*1000 < next start_ms`. Pure + exported for unit testing. Segments are
// ordered by startMs; returns -1 before the first segment begins.
export function activeSegmentIndex(segments: TranscriptSegment[], currentMs: number): number {
  let active = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].startMs <= currentMs) active = i;
    else break;
  }
  return active;
}

export function useListeningPlayer(
  audioRef: RefObject<HTMLAudioElement>,
  segments: TranscriptSegment[],
  volume: number,
): ListeningPlayer {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // Attach playback listeners to the audio element. Effects do not run during server-side render,
  // so this is inert in the render smoke tests (no DOM audio APIs are touched).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onCanPlay = (): void => setReady(true);
    // The <audio> element fires `error` when the src fails to load (e.g. the MP3 is missing on
    // disk → server 404). Without this, `canplay` never fires and the play button is disabled
    // forever with no feedback; surface the failure instead.
    const onError = (): void => setError(true);
    const onLoaded = (): void => setDurationMs((el.duration || 0) * 1000);
    const onTimeUpdate = (): void => setCurrentMs(el.currentTime * 1000);
    const onPlay = (): void => setIsPlaying(true);
    const onPause = (): void => setIsPlaying(false);
    // spec: docs/specs/listening-player.md §Behaviour.11 — at end, stop and reset to paused at 0.
    const onEnded = (): void => {
      el.currentTime = 0;
      setCurrentMs(0);
      setIsPlaying(false);
    };

    el.addEventListener('canplay', onCanPlay);
    el.addEventListener('error', onError);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('canplay', onCanPlay);
      el.removeEventListener('error', onError);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [audioRef]);

  // spec: docs/specs/listening-player.md §Behaviour.4 — apply the session's current volume level.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [audioRef, volume]);

  const play = useCallback(() => {
    void audioRef.current?.play();
  }, [audioRef]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, [audioRef]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, [audioRef]);

  // spec: docs/specs/listening-player.md §Behaviour.3 — seek to any position.
  const seekMs = useCallback(
    (ms: number) => {
      const el = audioRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, ms / 1000);
      setCurrentMs(Math.max(0, ms));
    },
    [audioRef],
  );

  // spec: docs/specs/listening-player.md §Behaviour.9 — click a segment → seek there and play.
  const seekToSegment = useCallback(
    (index: number) => {
      const seg = segments[index];
      if (!seg) return;
      seekMs(seg.startMs);
      void audioRef.current?.play();
    },
    [segments, seekMs, audioRef],
  );

  const activeIndex = useMemo(() => activeSegmentIndex(segments, currentMs), [segments, currentMs]);

  return {
    ready,
    error,
    isPlaying,
    currentMs,
    durationMs,
    activeIndex,
    play,
    pause,
    toggle,
    seekMs,
    seekToSegment,
  };
}
