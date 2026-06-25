import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type SessionDetail, type Section, fetchSession } from "../lib/api";
import { DIFFICULTY_BANDS } from "../lib/bands";
import {
  type RetryBand,
  groupIncorrectByBand,
} from "../features/review/groupByBand";
import { ReviewQuestionCard } from "../features/review/ReviewQuestionCard";
import type { SessionConfig } from "../features/quiz/types";

// spec: docs/specs/review-mode.md §Behaviour
// Read-only review of a completed session: every question in order with the user's answer vs. the
// correct one, learning-mode explanations, and a band-grouped retry of the incorrect questions.

export function ReviewPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchSession(Number(id))
      .then(setDetail)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load session"),
      )
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <Centered>Loading…</Centered>;
  }
  if (error || !detail) {
    return (
      <Centered className="text-red-600">
        {error ?? "Session not found"}
      </Centered>
    );
  }

  const { session, results } = detail;
  const section = session.section as Section;
  const bands = groupIncorrectByBand(results);

  // spec: docs/specs/review-mode.md §Behaviour.8–10 — one learning-mode session per affected band,
  // started by handing the home route a retry config (band difficulty + that band's wrong ids).
  function startRetry(band: RetryBand): void {
    const retryConfig: SessionConfig = {
      section,
      mode: "learning",
      difficulty: band.difficulty,
      questionIds: band.questionIds,
    };
    navigate("/", { state: { retryConfig } });
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-slate-500 transition hover:text-slate-900"
        >
          ← Back
        </button>
        <span className="font-semibold text-slate-900">Review answers</span>
        <span className="ml-auto text-sm text-slate-500">
          <span className="capitalize">{session.section}</span> ·{" "}
          <span className="capitalize">{session.mode}</span> · {session.correct}{" "}
          / {session.total} correct
        </span>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {bands.length > 0 && <RetryPanel bands={bands} onRetry={startRetry} />}

        {/* spec: llm-enrichment §Behaviour.10 — explanations show in review for learning AND real. */}
        {results.map((r, i) => (
          <ReviewQuestionCard key={r.id} index={i} result={r} showExplanation />
        ))}
      </div>
    </main>
  );
}

function shortBandName(slug: RetryBand["difficulty"]): string {
  return DIFFICULTY_BANDS.find((b) => b.slug === slug)?.name ?? slug;
}

// spec: docs/specs/review-mode.md §Behaviour.7–9
function RetryPanel({
  bands,
  onRetry,
}: {
  bands: RetryBand[];
  onRetry: (band: RetryBand) => void;
}): JSX.Element {
  const totalWrong = bands.reduce((sum, b) => sum + b.count, 0);

  if (bands.length === 1) {
    const band = bands[0];
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          {totalWrong} incorrect {totalWrong === 1 ? "answer" : "answers"} in
          this session.
        </p>
        <button
          type="button"
          onClick={() => onRetry(band)}
          className="mt-3 rounded-xl bg-brand-600 px-5 py-2.5 font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 active:scale-[0.98]"
        >
          Retry incorrect questions ({band.count})
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">
        Retry incorrect questions
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Your {totalWrong} wrong answers span {bands.length} difficulty bands.
        Each starts its own learning session — retry them one at a time.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {bands.map((band) => (
          <button
            key={band.difficulty}
            type="button"
            onClick={() => onRetry(band)}
            className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 active:scale-[0.98]"
          >
            Retry {shortBandName(band.difficulty)} ({band.count})
          </button>
        ))}
      </div>
    </section>
  );
}

function Centered({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className={className ?? "text-slate-500"}>{children}</p>
    </main>
  );
}
