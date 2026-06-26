import { formatClock } from "../../lib/format";

// spec: docs/specs/reading-quiz-ui.md §Layout.6 — countdown timer in the header (real mode).
type Props = { remainingMs: number };

export function CountdownTimer({ remainingMs }: Props): JSX.Element {
  const urgent = remainingMs <= 60_000;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ring-1 transition ${
        urgent
          ? "animate-pulse bg-red-50 text-red-700 ring-red-200"
          : "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
      aria-label="Time remaining"
    >
      <span aria-hidden>⏱</span>
      {formatClock(remainingMs)}
    </span>
  );
}
