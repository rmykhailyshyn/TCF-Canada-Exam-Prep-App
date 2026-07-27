import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopNav } from "../components/TopNav";
import { type SessionSummary, fetchSessions } from "../lib/api";
import { bandName } from "../lib/bands";
import { formatClock } from "../lib/format";
import type { DifficultySlug } from "../lib/api";

// spec: docs/specs/progress-tracking.md §Behaviour.4–8

function scoreLabel(s: SessionSummary): string {
  // spec: docs/specs/progress-tracking.md §Writing & speaking sessions — writing/speaking rows show
  // the overall /20 average + tasks submitted, not correct/total.
  if (s.section === "writing" || s.section === "speaking") {
    const time = s.elapsedMs !== null ? ` · ${formatClock(s.elapsedMs)}` : "";
    // spec: docs/specs/content-deploy.md §Behaviour.7 — an online (unscored) session has a null
    // overall score; show "not scored" rather than a fabricated "0 / 20".
    const score =
      s.overallScore == null ? "not scored" : `${s.overallScore} / 20 avg`;
    return `${score} · ${s.tasksSubmitted ?? 0} tasks${time}`;
  }
  if (s.mode === "real") {
    const points =
      s.pointsScored !== null && s.pointsPossible !== null
        ? `${s.pointsScored} / ${s.pointsPossible} pts · `
        : "";
    const time = s.elapsedMs !== null ? ` · ${formatClock(s.elapsedMs)}` : "";
    return `${points}${s.correct} / ${s.total} correct${time}`;
  }
  const diff = s.difficulty
    ? `${bandName(s.difficulty as DifficultySlug)} · `
    : "";
  return `${diff}${s.correct} / ${s.total} correct`;
}

// Writing/speaking "learning" mode is presented as "Training" (spec: writing-session +
// speaking-session §Mode storage note).
function modeLabel(s: SessionSummary): string {
  if (
    (s.section === "writing" || s.section === "speaking") &&
    s.mode === "learning"
  )
    return "Training";
  return s.mode;
}

export function HistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions()
      .then(({ sessions: rows }) => setSessions(rows))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load history"),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* spec: section-navigation §Behaviour.2 — History is reachable via the persistent top menu.
          TopNav (a <header>/banner) sits outside <main> so its landmark role is preserved. */}
      <TopNav active="history" />
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-2xl p-6">
          <h1 className="mb-4 text-2xl font-bold tracking-tight text-slate-900">
            Session History
          </h1>
          {loading && <p className="text-slate-500">Loading…</p>}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && !error && sessions.length === 0 && (
            <p className="text-slate-500">No completed sessions yet.</p>
          )}
          {!loading && !error && sessions.length > 0 && (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() =>
                      void navigate(
                        s.section === "writing"
                          ? `/writing/${s.id}`
                          : s.section === "speaking"
                            ? `/speaking/${s.id}`
                            : `/history/${s.id}`,
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-sky-400 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="font-medium text-slate-900 capitalize">
                          {s.section}
                        </span>
                        <span className="mx-2 text-slate-300">·</span>
                        <span className="text-slate-600 capitalize">
                          {modeLabel(s)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {new Date(s.completedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {scoreLabel(s)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
