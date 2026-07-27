import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { type SpeakingSessionDetail, fetchSpeakingSession } from "../lib/api";

// spec: docs/specs/speaking-ui.md §Results / review (Behaviour.15–16) — read-only review of a past
// speaking session, reached from the history list, with per-task audio playback.

export function SpeakingReviewPage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams();
  const [detail, setDetail] = useState<SpeakingSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sessionId = Number(id);
    if (!Number.isInteger(sessionId)) {
      setError("Invalid session id.");
      return;
    }
    fetchSpeakingSession(sessionId)
      .then(setDetail)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Failed to load session."),
      );
  }, [id]);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <button
          type="button"
          onClick={() => void navigate("/history")}
          className="text-sm text-slate-500 transition hover:text-slate-900"
        >
          ← Back
        </button>
        <span className="font-semibold text-slate-900">Speaking review</span>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 p-6">
        {error && <p className="text-red-600">{error}</p>}
        {!error && !detail && <p className="text-slate-500">Loading…</p>}
        {detail && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {/* spec: docs/specs/content-deploy.md §Behaviour.7 — online (unscored) sessions have a
                  null overall score; render "Practice — not scored" rather than "0 / 20 avg". */}
              {detail.session.overallScore == null ? (
                <p className="text-2xl font-extrabold text-slate-900">
                  Practice — not scored
                </p>
              ) : (
                <p className="text-2xl font-extrabold text-slate-900 tabular-nums">
                  {detail.session.overallScore}{" "}
                  <span className="text-base text-slate-400">/ 20 avg</span>
                </p>
              )}
              <p className="mt-1 text-sm text-slate-500">
                {detail.session.submitted} / {detail.tasks.length} tasks
                submitted
              </p>
            </div>

            {detail.tasks.map((t) => (
              <div
                key={t.taskNumber}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">
                    Task {t.taskNumber}
                  </h2>
                  <span className="text-sm font-bold tabular-nums text-slate-900">
                    {t.score == null
                      ? "not submitted"
                      : `${t.score} / 20 · ${t.level}`}
                  </span>
                </div>
                <p
                  className="mt-2 whitespace-pre-wrap text-sm text-slate-600"
                  lang="fr"
                >
                  {t.question}
                </p>
                {t.audioUrl && (
                  <audio
                    controls
                    src={t.audioUrl}
                    preload="none"
                    className="mt-3 w-full"
                    aria-label={`Recording for task ${t.taskNumber}`}
                  />
                )}
                <div className="mt-3 rounded-xl bg-slate-50 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Transcript
                  </h3>
                  <p
                    className="mt-1 whitespace-pre-wrap text-sm text-slate-800"
                    lang="fr"
                  >
                    {t.transcript || "(no recording)"}
                  </p>
                </div>
                {t.sampleAnswer && (
                  <div className="mt-3 rounded-xl bg-slate-50 p-3">
                    <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                      Sample answer
                    </h3>
                    <p
                      className="mt-1 whitespace-pre-wrap text-sm text-slate-700"
                      lang="fr"
                    >
                      {t.sampleAnswer}
                    </p>
                  </div>
                )}
                {t.feedback && (
                  <div className="mt-3 space-y-1 text-sm text-slate-700">
                    <p>
                      <span className="font-semibold">Strengths: </span>
                      {t.feedback.strengths}
                    </p>
                    <p>
                      <span className="font-semibold">Errors: </span>
                      {t.feedback.errors}
                    </p>
                    <p>
                      <span className="font-semibold">Improvements: </span>
                      {t.feedback.improvements}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </main>
  );
}
