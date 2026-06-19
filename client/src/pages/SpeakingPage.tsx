import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Spinner } from '../components/Spinner';
import { TopNav } from '../components/TopNav';
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
    // spec: section-navigation §Behaviour.2 — persistent top menu on the section setup screen.
    // TopNav (a <header>/banner) sits outside <main> so its landmark role is preserved.
    return (
      <>
        <TopNav active="speaking" />
        <main className="min-h-screen">
          <SpeakingSetup onStart={setConfig} />
        </main>
      </>
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

function Centered({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-slate-600">
      {children}
    </div>
  );
}
