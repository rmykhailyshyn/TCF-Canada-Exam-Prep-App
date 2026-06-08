import { formatClock } from '../../lib/format';

// spec: docs/specs/reading-quiz-ui.md §Layout.6 — countdown timer in the header (real mode).
type Props = { remainingMs: number };

export function CountdownTimer({ remainingMs }: Props): JSX.Element {
  const urgent = remainingMs <= 60_000;
  return (
    <span
      className={`tabular-nums font-medium ${urgent ? 'text-red-600' : 'text-slate-700'}`}
      aria-label="Time remaining"
    >
      ⏱ {formatClock(remainingMs)}
    </span>
  );
}
