import type { ReactNode } from 'react';
import { Spinner } from '../components/Spinner';
import { ListeningQuizScreen } from '../features/listening/ListeningQuizScreen';
import { ResultsScreen } from '../features/quiz/ResultsScreen';
import type { SessionConfig } from '../features/quiz/types';
import { useQuizSession } from '../features/quiz/useQuizSession';

// spec: docs/specs/listening-quiz-ui.md §Behaviour
// Route-level orchestrator: runs one listening session through its lifecycle (loading → active →
// results) using the shared quiz-session hook, rendering the listening screen while active.

type Props = { config: SessionConfig; onExit: () => void };

export function ListeningQuizPage({ config, onExit }: Props): JSX.Element {
  const session = useQuizSession(config);

  if (session.status === 'loading') {
    return (
      <Centered>
        <Spinner label="Starting session…" />
      </Centered>
    );
  }

  if (session.status === 'error') {
    return (
      <Centered>
        <p className="text-red-700">{session.error ?? 'Something went wrong.'}</p>
        <button
          type="button"
          onClick={onExit}
          className="mt-4 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white shadow-brand-glow transition hover:bg-brand-700 active:scale-[0.98]"
        >
          Back to home
        </button>
      </Centered>
    );
  }

  if (session.status === 'finished' && session.results) {
    return (
      <ResultsScreen
        results={session.results}
        elapsedMs={session.elapsedMs}
        config={config}
        sessionId={session.sessionId}
        onHome={onExit}
      />
    );
  }

  return <ListeningQuizScreen session={session} config={config} />;
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-slate-600">
      {children}
    </div>
  );
}
