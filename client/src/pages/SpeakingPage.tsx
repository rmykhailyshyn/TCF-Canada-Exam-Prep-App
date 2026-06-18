import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { SpeakingResults } from '../features/speaking/SpeakingResults';
import { SpeakingSession } from '../features/speaking/SpeakingSession';
import { SpeakingSetup } from '../features/speaking/SpeakingSetup';
import type { SpeakingConfig } from '../features/speaking/types';
import { useSpeakingSession } from '../features/speaking/useSpeakingSession';

// spec: docs/specs/speaking-ui.md — setup → recorder → results, mirroring the writing page.

export function SpeakingPage(): JSX.Element {
  const navigate = useNavigate();
  const [config, setConfig] = useState<SpeakingConfig | null>(null);

  if (!config) {
    return (
      <main className="min-h-screen">
        <Header onHome={() => navigate('/')} />
        <SpeakingSetup onStart={setConfig} />
      </main>
    );
  }

  return <SpeakingRunner config={config} onHome={() => navigate('/')} />;
}

function SpeakingRunner({ config, onHome }: { config: SpeakingConfig; onHome: () => void }): JSX.Element {
  const session = useSpeakingSession(config);

  if (session.status === 'loading') {
    return (
      <Centered>
        <Spinner label="Starting speaking session…" />
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
    return <SpeakingResults results={session.results} elapsedMs={session.elapsedMs} onHome={onHome} />;
  }

  return <SpeakingSession session={session} />;
}

function Header({ onHome }: { onHome: () => void }): JSX.Element {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
      <button type="button" onClick={onHome} className="text-sm text-sky-600 hover:text-sky-700">
        ← Home
      </button>
    </header>
  );
}

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-slate-600">
      {children}
    </div>
  );
}
