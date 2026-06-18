import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { TopNav } from '../components/TopNav';
import { WritingEditor } from '../features/writing/WritingEditor';
import { WritingResults } from '../features/writing/WritingResults';
import { WritingSetup } from '../features/writing/WritingSetup';
import type { WritingConfig } from '../features/writing/types';
import { useWritingSession } from '../features/writing/useWritingSession';

// spec: docs/specs/writing-ui.md — setup → editor → results, mirroring the reading/listening pages.

export function WritingPage(): JSX.Element {
  const navigate = useNavigate();
  const [config, setConfig] = useState<WritingConfig | null>(null);

  if (!config) {
    // spec: section-navigation §Behaviour.2 — persistent top menu on the section setup screen.
    return (
      <main className="min-h-screen">
        <TopNav active="writing" />
        <WritingSetup onStart={setConfig} />
      </main>
    );
  }

  return <WritingRunner config={config} onHome={() => navigate('/')} />;
}

function WritingRunner({
  config,
  onHome,
}: {
  config: WritingConfig;
  onHome: () => void;
}): JSX.Element {
  const session = useWritingSession(config);

  if (session.status === 'loading') {
    return (
      <Centered>
        <Spinner label="Starting writing session…" />
      </Centered>
    );
  }

  if (session.status === 'error') {
    return (
      <Centered>
        <p className="text-red-700">{session.error ?? 'Something went wrong.'}</p>
        <button
          type="button"
          onClick={onHome}
          className="mt-4 rounded-xl bg-brand-600 px-4 py-2 font-semibold text-white shadow-brand-glow transition hover:bg-brand-700"
        >
          Back to home
        </button>
      </Centered>
    );
  }

  if (session.status === 'finished' && session.results) {
    return (
      <WritingResults
        results={session.results}
        tasks={session.tasks}
        elapsedMs={session.elapsedMs}
        onHome={onHome}
      />
    );
  }

  return <WritingEditor session={session} />;
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-slate-600">
      {children}
    </div>
  );
}
