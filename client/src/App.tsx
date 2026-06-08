import { useState } from 'react';
import { SetupScreen } from './features/quiz/SetupScreen';
import type { SessionConfig } from './features/quiz/types';
import { ReadingQuizPage } from './pages/ReadingQuizPage';

// spec: docs/specs/reading-quiz-ui.md
// Top-level flow: the setup screen until a session is configured, then the reading quiz page.
// "Back to home" / completion clears the config and returns to setup. A router will replace this
// when session history (Milestone 4) and review mode (Milestone 5) add real navigation.

function App(): JSX.Element {
  const [config, setConfig] = useState<SessionConfig | null>(null);

  if (config) {
    return <ReadingQuizPage config={config} onExit={() => setConfig(null)} />;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-3">
        <span className="font-semibold text-slate-900">TCF Canada Prep</span>
      </header>
      <SetupScreen onStart={setConfig} />
    </main>
  );
}

export default App;
