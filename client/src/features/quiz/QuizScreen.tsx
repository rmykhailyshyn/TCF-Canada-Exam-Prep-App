import { useState } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { ProgressCounter } from '../../components/ProgressCounter';
import { CountdownTimer } from './CountdownTimer';
import { ConfirmDialog } from './ConfirmDialog';
import { PassagePanel } from './PassagePanel';
import { QuestionPanel } from './QuestionPanel';
import type { QuizSession } from './useQuizSession';
import type { SessionConfig } from './types';

// spec: docs/specs/reading-quiz-ui.md §Layout.3–6 + §Real mode.16–17
// The active-session screen: header (mode, counter, real-mode timer), split passage/question
// layout, and the early-submit control for real mode.

type Props = { session: QuizSession; config: SessionConfig };

export function QuizScreen({ session, config }: Props): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { question } = session;
  if (!question) return <div className="p-6 text-slate-500">No questions in this band.</div>;

  const modeLabel = config.mode === 'real' ? 'Real' : 'Learning';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark context={`Reading · ${modeLabel}`} />
        <div className="ml-auto flex items-center gap-5">
          {config.mode === 'real' && session.remainingMs !== null && (
            <CountdownTimer remainingMs={session.remainingMs} />
          )}
          <ProgressCounter index={session.index} total={session.total} />
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-2">
        <PassagePanel key={question.id} questionId={question.id} passage={question.passage} />
        <div className="min-h-0 overflow-y-auto">
          <QuestionPanel
            question={question}
            mode={config.mode}
            selectedLabel={session.selectedLabel}
            feedback={session.feedback}
            submitting={session.submitting}
            onSelect={session.select}
            onConfirm={session.confirm}
            onNext={session.goNext}
          />
        </div>
      </main>

      {config.mode === 'real' && (
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
