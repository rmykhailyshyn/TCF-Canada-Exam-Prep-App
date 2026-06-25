import type { SpeakingCompleteResult } from "../../lib/api";
import { formatClock } from "../../lib/format";

// spec: docs/specs/speaking-ui.md §Results (Behaviour.15–16)
// Per-task score /20 + NCLC + the overall average, shown after completion.

type Props = {
  results: SpeakingCompleteResult;
  elapsedMs: number | null;
  onHome: () => void;
};

export function SpeakingResults({
  results,
  elapsedMs,
  onHome,
}: Props): JSX.Element {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center p-6 text-center">
      <div className="w-full animate-fade-in-up overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card-hover">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-8 pb-8 pt-9 text-white">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ring-1 ring-white/20">
            ✓ Speaking complete
          </span>
          <p className="mt-3 text-5xl font-extrabold tracking-tight">
            {results.overallScore}
            <span className="text-2xl font-bold text-brand-200"> / 20</span>
          </p>
          <p className="mt-1 text-sm font-medium text-brand-200">
            average · {results.submitted} / {results.tasks.length} tasks
            submitted
            {elapsedMs !== null && <> · {formatClock(elapsedMs)}</>}
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {results.tasks.map((t) => (
            <div
              key={t.taskNumber}
              className="flex items-center justify-between px-6 py-4 text-left"
            >
              <div>
                <div className="font-semibold text-slate-900">
                  Task {t.taskNumber}
                </div>
                <div className="text-xs text-slate-400">
                  {t.level ?? "not submitted"}
                </div>
              </div>
              <div className="text-lg font-bold tabular-nums text-slate-900">
                {t.score == null ? "—" : `${t.score} / 20`}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center p-6">
          <button
            type="button"
            onClick={onHome}
            className="rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 active:scale-[0.98]"
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
