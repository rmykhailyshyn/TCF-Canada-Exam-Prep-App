// Shared header progress indicator: "Question N of T" with a thin fill bar beneath it.
// Used by both the reading and listening quiz shells.

type Props = { index: number; total: number };

export function ProgressCounter({ index, total }: Props): JSX.Element {
  const current = index + 1;
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="flex min-w-[7rem] flex-col items-end gap-1.5">
      <span className="text-sm font-medium tabular-nums text-slate-500">
        Question {current} of {total}
      </span>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-600 transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
