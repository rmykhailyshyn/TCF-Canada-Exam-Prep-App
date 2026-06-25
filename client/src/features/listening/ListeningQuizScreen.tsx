import { useCallback, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { ProgressCounter } from "../../components/ProgressCounter";
import { CountdownTimer } from "../quiz/CountdownTimer";
import { ConfirmDialog } from "../quiz/ConfirmDialog";
import { QuestionPanel } from "../quiz/QuestionPanel";
import type { QuizSession } from "../quiz/useQuizSession";
import type { SessionConfig } from "../quiz/types";
import { ListeningPlayer } from "./ListeningPlayer";

// spec: docs/specs/listening-quiz-ui.md §Layout (Behaviour.3–6) + §Real mode.16–17
// The active listening-session screen: header (mode, counter, real-mode timer), the player above
// the question + options, and the early-submit control for real mode. The player occupies the
// upper portion; the question and four options sit below it (Behaviour.3–4).

type Props = { session: QuizSession; config: SessionConfig };

export function ListeningQuizScreen({ session, config }: Props): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // spec: docs/specs/listening-player.md §Behaviour.4 — volume persists across questions for the
  // session (lifted here so it survives the per-question player remount).
  const [volume, setVolume] = useState(1);
  // spec: docs/specs/listening-player.md §Behaviour.1 — gate options until the clip can play.
  const [audioReady, setAudioReady] = useState(false);

  const { question } = session;

  // Reset readiness whenever the question changes (a fresh clip must finish loading again).
  const onReadyChange = useCallback(
    (ready: boolean) => setAudioReady(ready),
    [],
  );

  if (!question)
    return <div className="p-6 text-slate-500">No questions in this band.</div>;

  const modeLabel = config.mode === "real" ? "Real" : "Learning";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark context={`Listening · ${modeLabel}`} />
        <div className="ml-auto flex items-center gap-5">
          {config.mode === "real" && session.remainingMs !== null && (
            <CountdownTimer remainingMs={session.remainingMs} />
          )}
          <ProgressCounter index={session.index} total={session.total} />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,45%)_minmax(0,55%)] gap-4 overflow-hidden p-4">
        <ListeningPlayer
          key={question.id}
          questionId={question.id}
          volume={volume}
          onVolumeChange={setVolume}
          onReadyChange={onReadyChange}
        />
        <div className="min-h-0 overflow-y-auto">
          <QuestionPanel
            question={question}
            mode={config.mode}
            selectedLabel={session.selectedLabel}
            feedback={session.feedback}
            submitting={session.submitting}
            locked={!audioReady}
            onSelect={session.select}
            onConfirm={session.confirm}
            onNext={session.goNext}
          />
        </div>
      </main>

      {config.mode === "real" && (
        <footer className="flex justify-end border-t border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]"
          >
            Submit exam
          </button>
        </footer>
      )}

      {confirmOpen && (
        <ConfirmDialog
          title="Submit exam?"
          message="This ends the session and shows your results. You can't go back."
          confirmLabel="Submit exam"
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            session.submitExam();
          }}
        />
      )}
    </div>
  );
}
