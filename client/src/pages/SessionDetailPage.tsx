import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { type SessionDetail, fetchSession } from '../lib/api';
import { bandName } from '../lib/bands';
import { formatClock } from '../lib/format';
import type { DifficultySlug } from '../lib/api';

// spec: docs/specs/progress-tracking.md §Behaviour.7

export function SessionDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchSession(Number(id))
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load session'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-red-600">{error ?? 'Session not found'}</p>
      </main>
    );
  }

  const { session: s } = detail;
  const isReal = s.mode === 'real';

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="text-slate-500 hover:text-slate-900 transition text-sm"
        >
          ← History
        </button>
        <span className="font-semibold text-slate-900">Session Detail</span>
      </header>

      <div className="mx-auto max-w-lg p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Session complete</h1>
          <p className="mt-1 text-slate-500">
            <span className="capitalize">{s.section}</span>
            {' · '}
            <span className="capitalize">{s.mode}</span>
            {!isReal && s.difficulty && (
              <> · {bandName(s.difficulty as DifficultySlug)}</>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {new Date(s.completedAt).toLocaleString()}
          </p>

          <div className="mt-6 space-y-1">
            {isReal && s.pointsScored !== null && s.pointsPossible !== null && (
              <p className="text-3xl font-bold text-slate-900">
                {s.pointsScored} / {s.pointsPossible} points
              </p>
            )}
            <p className={isReal ? 'text-lg text-slate-700' : 'text-3xl font-bold text-slate-900'}>
              {s.correct} / {s.total} correct
            </p>
            {isReal && s.elapsedMs !== null && (
              <p className="text-slate-500">Completed in {formatClock(s.elapsedMs)}</p>
            )}
          </div>

          <div className="mt-8 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/review/${s.id}`)}
              className="rounded-xl border border-slate-200 px-4 py-2 font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Review answers
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-xl bg-sky-600 px-4 py-2 font-medium text-white transition hover:bg-sky-700"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
