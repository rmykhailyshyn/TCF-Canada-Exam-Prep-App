import { useEffect, useRef, useState } from 'react';
import { ApiError, type TranscriptSegment, audioUrl, fetchTranscript } from '../../lib/api';
import { formatClock } from '../../lib/format';
import { SubtitleList } from './SubtitleList';
import { useListeningPlayer } from './useListeningPlayer';

// spec: docs/specs/listening-player.md §Behaviour
// The listening player: audio controls (play/pause, scrubber, volume) above a phrase-level
// subtitle overlay with a moving highlight and click-to-seek. Fetches its own transcript for the
// question. Reports load state up so the quiz screen can gate the options until audio is ready
// (Behaviour.1). Mounted with a key per question, so it fully resets between questions.

type Props = {
  questionId: number;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onReadyChange: (ready: boolean) => void;
};

export function ListeningPlayer({
  questionId,
  volume,
  onVolumeChange,
  onReadyChange,
}: Props): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const player = useListeningPlayer(audioRef, segments, volume);

  // spec: docs/specs/listening-player.md §Subtitle overlay.5 — load this question's segments.
  useEffect(() => {
    let cancelled = false;
    fetchTranscript(questionId)
      .then((res) => {
        if (!cancelled) setSegments(res.segments);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTranscriptError(err instanceof ApiError ? err.message : 'Failed to load subtitles.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  // spec: docs/specs/listening-player.md §Behaviour.1 — options unlock once audio can play.
  useEffect(() => {
    onReadyChange(player.ready);
  }, [player.ready, onReadyChange]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      {/* preload metadata so the scrubber has a duration and `canplay` fires early */}
      <audio ref={audioRef} src={audioUrl(questionId)} preload="auto" className="hidden" />

      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={player.toggle}
          disabled={!player.ready}
          aria-label={player.isPlaying ? 'Pause' : 'Play'}
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sky-600 text-white transition enabled:hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {player.isPlaying ? '❚❚' : '▶'}
        </button>

        <input
          type="range"
          min={0}
          max={player.durationMs || 0}
          value={Math.min(player.currentMs, player.durationMs || 0)}
          onChange={(e) => player.seekMs(Number(e.target.value))}
          disabled={!player.ready}
          aria-label="Seek"
          className="flex-1 accent-sky-600"
        />

        <span className="flex-none tabular-nums text-xs text-slate-500">
          {formatClock(player.currentMs)} / {formatClock(player.durationMs)}
        </span>

        <label className="flex flex-none items-center gap-1 text-slate-400" title="Volume">
          <span aria-hidden>🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            aria-label="Volume"
            className="w-20 accent-sky-600"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {transcriptError ? (
          <p className="p-4 text-sm italic text-slate-400">{transcriptError}</p>
        ) : (
          <SubtitleList
            segments={segments}
            activeIndex={player.activeIndex}
            onSeek={player.seekToSegment}
          />
        )}
      </div>

      {!player.ready && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs italic text-slate-400">
          Loading audio…
        </p>
      )}
    </div>
  );
}
