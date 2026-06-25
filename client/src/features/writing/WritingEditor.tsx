import { useRef, useState } from "react";
import { BrandMark } from "../../components/BrandMark";
import { CountdownTimer } from "../quiz/CountdownTimer";
import { ConfirmDialog } from "../quiz/ConfirmDialog";
import { VirtualKeyboard } from "./VirtualKeyboard";
import { WordCounter } from "./WordCounter";
import type { WritingSession } from "./useWritingSession";

// spec: docs/specs/writing-ui.md §Editor / Training mode / Real mode
// One textarea per task with a live word counter; training shows the sample answer + template and a
// "Get correction" + per-task "Submit for score"; real mode shows the single countdown and one
// "Submit exam" action.

type Props = { session: WritingSession };

export function WritingEditor({ session }: Props): JSX.Element {
  const [active, setActive] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // spec: docs/specs/virtual-keyboard.md §Behaviour.2 — the accent keyboard inserts into the active
  // task's textarea via this ref (the element is reused across task tabs, so the ref stays valid).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isReal = session.mode === "real";
  const task = session.tasks[active];
  if (!task)
    return (
      <div className="p-6 text-slate-500">No writing tasks available.</div>
    );

  const n = task.taskNumber;
  const evaluation = session.evaluations[n];
  const correction = session.corrections[n];
  const error = session.taskError[n];
  const busy = session.busyTask === n;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark context={`Writing · ${isReal ? "Real" : "Training"}`} />
        <div className="ml-auto flex items-center gap-4">
          {isReal && session.remainingMs !== null && (
            <CountdownTimer remainingMs={session.remainingMs} />
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

      {session.tasks.length > 1 && (
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

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
        <section className="min-h-0 space-y-4 overflow-y-auto">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              Task {n}
              {task.title ? ` · ${task.title}` : ""}
            </h2>
            <p className="mt-3 whitespace-pre-wrap text-slate-800" lang="fr">
              {task.prompt}
            </p>
            {task.instructions && (
              <p className="mt-3 text-sm text-slate-500" lang="fr">
                {task.instructions}
              </p>
            )}
          </div>

          {!isReal && task.sampleAnswer && (
            <Collapsible title="Sample answer">
              <p
                className="whitespace-pre-wrap text-sm text-slate-700"
                lang="fr"
              >
                {task.sampleAnswer}
              </p>
            </Collapsible>
          )}
          {!isReal && task.template && (
            <Collapsible title="Answer template">
              <p
                className="whitespace-pre-wrap text-sm text-slate-700"
                lang="fr"
              >
                {task.template}
              </p>
            </Collapsible>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <WordCounter
              count={session.counts[n] ?? 0}
              minWords={task.minWords}
              maxWords={task.maxWords}
            />
            {!isReal && (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => session.correct(n)}
                  className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Get correction
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => session.submit(n)}
                  className="rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Submit for score"}
                </button>
              </div>
            )}
          </div>

          {/* spec: virtual-keyboard.md §Behaviour.1 — shown above each textarea in both modes.
              `key={active}` remounts it per task tab so the shift toggle resets to lowercase. */}
          <VirtualKeyboard key={active} textareaRef={textareaRef} />

          <textarea
            ref={textareaRef}
            value={session.drafts[n] ?? ""}
            onChange={(e) => session.setDraft(n, e.target.value)}
            onBlur={() => session.saveNow(n)}
            lang="fr"
            spellCheck={false}
            placeholder="Écrivez votre réponse ici…"
            className="min-h-[16rem] flex-1 resize-none rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-card outline-none focus:border-brand-400"
          />

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </p>
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
              <Feedback
                label="Strengths"
                text={evaluation.feedback.strengths}
              />
              <Feedback label="Errors" text={evaluation.feedback.errors} />
              <Feedback
                label="Improvements"
                text={evaluation.feedback.improvements}
              />
            </div>
          )}
        </section>
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
