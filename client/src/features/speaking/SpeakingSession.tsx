import { useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { CountdownTimer } from "../quiz/CountdownTimer";
import { ConfirmDialog } from "../quiz/ConfirmDialog";
import { SpeakingRecorder } from "./SpeakingRecorder";
import type { SpeakingSession as SpeakingSessionState } from "./useSpeakingSession";

// spec: docs/specs/speaking-ui.md §Training mode / Real mode (Behaviour.8–14)
// Training shows task tabs (single task or all three) with manual record/submit/correct; real mode
// presents one task at a time with a prep-then-record countdown, auto-advancing through all three.

type Props = { session: SpeakingSessionState };

export function SpeakingSession({ session }: Props): JSX.Element {
  const [active, setActive] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isReal = session.mode === "real";

  // Real mode follows the session's currentIndex; training lets the user switch tabs freely.
  const index = isReal ? session.currentIndex : active;
  const task = session.tasks[index];
  if (!task)
    return (
      <div className="p-6 text-slate-500">No speaking tasks available.</div>
    );

  const prepping = isReal && session.realPhase === "prep";
  const phaseLabel =
    session.realPhase === "prep"
      ? "Preparation"
      : session.realPhase === "recording"
        ? "Recording"
        : "Transcribing…";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark context={`Speaking · ${isReal ? "Real" : "Training"}`} />
        <div className="ml-auto flex items-center gap-4">
          {isReal && (
            <>
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                Task {task.taskNumber} · {phaseLabel}
              </span>
              {session.phaseRemainingMs !== null &&
                session.realPhase !== "uploading" && (
                  <CountdownTimer remainingMs={session.phaseRemainingMs} />
                )}
            </>
          )}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98]"
          >
            {isReal ? "Submit exam" : "Finish"}
          </button>
        </div>
      </header>

      {!isReal && session.tasks.length > 1 && (
        <nav className="flex gap-2 border-b border-slate-200/70 bg-white/60 px-6 py-2">
          {session.tasks.map((t, i) => {
            const done = session.evaluations[t.taskNumber] != null;
            return (
              <button
                key={t.taskNumber}
                type="button"
                onClick={() => setActive(i)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  i === active
                    ? "bg-brand-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Task {t.taskNumber}
                {done && <span aria-hidden> ✓</span>}
              </button>
            );
          })}
        </nav>
      )}

      <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto p-4">
        {isReal && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            {prepping
              ? "Prepare your answer. Recording starts automatically when the timer ends."
              : session.realPhase === "recording"
                ? "Recording — it stops automatically when the timer ends (or stop early)."
                : "Uploading and transcribing your answer…"}
          </p>
        )}
        <SpeakingRecorder
          session={session}
          taskNumber={task.taskNumber}
          question={task.question}
          sampleAnswer={task.sampleAnswer}
          isReal={isReal}
          recordingDisabled={prepping || session.realPhase === "uploading"}
        />
      </main>

      {confirmOpen && (
        <ConfirmDialog
          title={isReal ? "Submit exam?" : "Finish session?"}
          message="This ends the session and shows your results. You can't go back."
          confirmLabel={isReal ? "Submit exam" : "Finish"}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            if (isReal) session.submitExam();
            else session.finish();
          }}
        />
      )}
    </div>
  );
}
