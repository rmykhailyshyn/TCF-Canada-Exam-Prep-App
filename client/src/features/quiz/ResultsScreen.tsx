import { useNavigate } from 'react-router-dom';
import type { CompleteResult } from '../../lib/api';
import { bandName } from '../../lib/bands';
import { formatClock } from '../../lib/format';
import type { SessionConfig } from './types';

// spec: docs/specs/quiz-session.md §Results.13 — learning shows correct/total + band;
// real shows points/699, correct/39, and time taken.
// spec: docs/specs/review-mode.md §Behaviour.1 — "Review answers" opens review mode for this session.

type Props = {
  results: CompleteResult;
  elapsedMs: number | null;
  config: SessionConfig;
  sessionId: number | null;
  onHome: () => void;
};

export function ResultsScreen({
  results,
  elapsedMs,
  config,
  sessionId,
  onHome,
}: Props): JSX.Element {
  const navigate = useNavigate();
  const isReal = config.mode === 'real';
  const sectionLabel = config.section === 'listening' ? 'Listening' : 'Reading';

  const accuracy = results.total > 0 ? Math.round((results.correct / results.total) * 100) : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center p-6 text-center">
      <div className="w-full animate-fade-in-up overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card-hover">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-8 pb-8 pt-9 text-white">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] ring-1 ring-white/20">
            ✓ Session complete
          </span>
          <p className="mt-4 text-sm font-medium text-brand-100">
            {sectionLabel} · {isReal ? 'Real' : 'Learning'}
            {!isReal && config.difficulty && <> · {bandName(config.difficulty)}</>}
          </p>
          {isReal && results.pointsScored !== null && results.pointsPossible !== null ? (
            <p className="mt-3 text-5xl font-extrabold tracking-tight">
              {results.pointsScored}
              <span className="text-2xl font-bold text-brand-200">
                {' '}
                / {results.pointsPossible}
              </span>
            </p>
          ) : (
            <p className="mt-3 text-5xl font-extrabold tracking-tight">
              {results.correct}
              <span className="text-2xl font-bold text-brand-200"> / {results.total}</span>
            </p>
          )}
          <p className="mt-1 text-sm font-medium text-brand-200">
            {isReal ? 'points scored' : 'correct answers'}
          </p>
        </div>

        <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
          <Stat label="Correct" value={`${results.correct} / ${results.total}`} />
          <Stat label="Accuracy" value={`${accuracy}%`} />
          <Stat
            label="Time"
            value={isReal && elapsedMs !== null ? formatClock(elapsedMs) : '—'}
          />
        </div>

        <div className="flex justify-center gap-3 p-6">
          <button
            type="button"
            disabled={sessionId == null}
            onClick={() => sessionId != null && navigate(`/review/${sessionId}`)}
            className="rounded-xl border border-slate-200 px-5 py-2.5 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Review answers
          </button>
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

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="px-3 py-4">
      <div className="text-lg font-bold tabular-nums text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}
