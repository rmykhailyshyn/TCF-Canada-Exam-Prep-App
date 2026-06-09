import { useEffect, useRef } from 'react';
import type { TranscriptSegment } from '../../lib/api';

// spec: docs/specs/listening-player.md §Subtitle overlay (Behaviour.5–10)
// Renders all transcript phrases, highlights the active one, auto-scrolls it into view, and seeks
// on click. Presentational only — playback state and seeking are owned by the player/hook.

type Props = {
  segments: TranscriptSegment[];
  activeIndex: number;
  onSeek: (index: number) => void;
};

export function SubtitleList({ segments, activeIndex, onSeek }: Props): JSX.Element {
  const activeRef = useRef<HTMLButtonElement>(null);

  // spec: docs/specs/listening-player.md §Behaviour.8 — keep the active segment in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (segments.length === 0) {
    return <p className="p-4 text-sm italic text-slate-400">No subtitles for this clip.</p>;
  }

  return (
    <ul className="space-y-1 p-2">
      {segments.map((seg, index) => {
        const active = index === activeIndex;
        return (
          <li key={seg.sequence}>
            <button
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSeek(index)}
              aria-current={active ? 'true' : undefined}
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm leading-relaxed transition ${
                active
                  ? 'bg-brand-100 font-semibold text-brand-900 ring-1 ring-brand-200'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`}
            >
              {seg.text}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
