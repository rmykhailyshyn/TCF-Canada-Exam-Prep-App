import { useState } from "react";
import { useCapabilities } from "../../lib/capabilities";
import type { SpeakingSession } from "./useSpeakingSession";

// spec: docs/specs/speaking-ui.md §Recorder / Training mode (Behaviour.5–11)
// Per-task panel: the French question, the record/stop control with local playback, the transcript
// returned after upload, and — training only — a collapsible sample answer, a "Get correction"
// action and a per-task "Submit for score" with the resulting score / NCLC / feedback.

type Props = {
  session: SpeakingSession;
  taskNumber: number;
  question: string;
  sampleAnswer?: string | null;
  isReal: boolean;
  // Real mode: recording is disabled during the prep phase (driven by the session timers).
  recordingDisabled?: boolean;
};

export function SpeakingRecorder({
  session,
  taskNumber,
  question,
  sampleAnswer,
  isReal,
  recordingDisabled,
}: Props): JSX.Element {
  // spec: docs/specs/content-deploy.md §Behaviour.5 — online (no transcription/aiScoring) keep
  // record + playback + sample answer, but hide the transcript, correction and scoring affordances.
  const { aiScoring, transcription } = useCapabilities();
  const n = taskNumber;
  const isRecording = session.recordingTask === n;
  const isUploading = session.uploading[n] === true;
  const transcript = session.transcripts[n];
  const evaluation = session.evaluations[n];
  const correction = session.corrections[n];
  const error = session.taskError[n];
  const recording = session.recordings[n];
  const busy = session.busyTask === n;
  const otherRecording =
    session.recordingTask != null && session.recordingTask !== n;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
          Task {n}
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-slate-800" lang="fr">
          {question}
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          {isRecording ? (
            <button
              type="button"
              onClick={() => session.stopRecording()}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-red-700 active:scale-[0.98]"
            >
              <span
                aria-hidden
                className="h-3 w-3 animate-pulse rounded-sm bg-white"
              />
              Stop recording
            </button>
          ) : (
            <button
              type="button"
              disabled={recordingDisabled || otherRecording || isUploading}
              onClick={() => session.startRecording(n)}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white shadow-brand-glow transition enabled:hover:bg-brand-700 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              <span aria-hidden className="h-3 w-3 rounded-full bg-white" />
              {recording ? "Re-record" : "Record"}
            </button>
          )}
          {isUploading && (
            <span className="text-sm text-slate-500">Transcribing…</span>
          )}
          {recording && !isRecording && (
            <audio
              controls
              src={recording.url}
              className="h-9"
              aria-label={`Playback task ${n}`}
            />
          )}
        </div>

        {session.micError && (
          <p className="mt-3 text-sm text-red-700">{session.micError}</p>
        )}

        {transcription && transcript != null && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              Transcript
            </h3>
            <p
              className="mt-1 whitespace-pre-wrap text-sm text-slate-700"
              lang="fr"
            >
              {transcript || "(no speech detected)"}
            </p>
          </div>
        )}

        {!isReal && aiScoring && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={busy || transcript == null}
              onClick={() => session.correct(n)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Get correction
            </button>
            <button
              type="button"
              disabled={busy || transcript == null}
              onClick={() => session.submit(n)}
              className="rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? "Working…" : "Submit for score"}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      {!isReal && sampleAnswer && (
        <Collapsible title="Sample answer">
          <p className="whitespace-pre-wrap text-sm text-slate-700" lang="fr">
            {sampleAnswer}
          </p>
        </Collapsible>
      )}

      {!isReal && correction && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <h3 className="text-sm font-semibold text-sky-900">
            Suggested correction
          </h3>
          <p
            className="mt-2 whitespace-pre-wrap text-sm text-slate-700"
            lang="fr"
          >
            {correction.correctedText}
          </p>
          {correction.suggestions.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
              {correction.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isReal && evaluation && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-emerald-800 tabular-nums">
              {evaluation.score} / 20
            </span>
            <span className="text-sm font-semibold text-emerald-700">
              {evaluation.level}
            </span>
          </div>
          <Feedback label="Strengths" text={evaluation.feedback.strengths} />
          <Feedback label="Errors" text={evaluation.feedback.errors} />
          <Feedback
            label="Improvements"
            text={evaluation.feedback.improvements}
          />
        </div>
      )}
    </div>
  );
}

function Feedback({
  label,
  text,
}: {
  label: string;
  text: string;
}): JSX.Element {
  return (
    <p className="mt-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">{label}: </span>
      {text}
    </p>
  );
}

function Collapsible({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-sm font-semibold text-slate-700"
      >
        {title}
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-5 py-3">{children}</div>
      )}
    </div>
  );
}
