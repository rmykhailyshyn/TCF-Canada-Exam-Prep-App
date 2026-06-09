import type { CompleteResult } from '../../lib/api';
import { bandName } from '../../lib/bands';
import { formatClock } from '../../lib/format';
import type { SessionConfig } from './types';

// spec: docs/specs/quiz-session.md §Results.13 — learning shows correct/total + band;
// real shows points/699, correct/39, and time taken.

type Props = {
  results: CompleteResult;
  elapsedMs: number | null;
  config: SessionConfig;
  onHome: () => void;
};

export function ResultsScreen({ results, elapsedMs, config, onHome }: Props): JSX.Element {
  const isReal = config.mode === 'real';
  const sectionLabel = config.section === 'listening' ? 'Listening' : 'Reading';

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center p-6 text-center">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Session complete</h1>
        <p className="mt-1 text-slate-500">
          {sectionLabel} · {isReal ? 'Real' : 'Learning'}
          {!isReal && config.difficulty && <> · {bandName(config.difficulty)}</>}
        </p>

        <div className="mt-6 space-y-1">
          {isReal && results.pointsScored !== null && results.pointsPossible !== null && (
            <p className="text-3xl font-bold text-slate-900">
              {results.pointsScored} / {results.pointsPossible} points
            </p>
          )}
          <p className={isReal ? 'text-lg text-slate-700' : 'text-3xl font-bold text-slate-900'}>
            {results.correct} / {results.total} correct
          </p>
          {isReal && elapsedMs !== null && (
            <p className="text-slate-500">Completed in {formatClock(elapsedMs)}</p>
          )}
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <button
            type="button"
            disabled
            title="Review mode arrives in a later milestone"
            className="rounded-xl border border-slate-200 px-4 py-2 font-medium text-slate-400"
          >
            Review answers
          </button>
          <button
            type="button"
            onClick={onHome}
            className="rounded-xl bg-sky-600 px-4 py-2 font-medium text-white transition hover:bg-sky-700"
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  );
}
