import { useState } from 'react';
import { BrandMark } from './components/BrandMark';
import { SetupScreen } from './features/quiz/SetupScreen';
import type { SessionConfig } from './features/quiz/types';
import { ListeningQuizPage } from './pages/ListeningQuizPage';
import { ReadingQuizPage } from './pages/ReadingQuizPage';

// spec: docs/specs/reading-quiz-ui.md + docs/specs/listening-quiz-ui.md
// Top-level flow: the setup screen until a session is configured, then the reading or listening
// quiz page (by chosen section). "Back to home" / completion clears the config and returns to
// setup. A router will replace this when session history (Milestone 4) and review mode
// (Milestone 5) add real navigation.

function App(): JSX.Element {
  const [config, setConfig] = useState<SessionConfig | null>(null);

  if (config) {
    const onExit = () => setConfig(null);
    return config.section === 'listening' ? (
      <ListeningQuizPage config={config} onExit={onExit} />
    ) : (
      <ReadingQuizPage config={config} onExit={onExit} />
    );
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark />
      </header>
      <SetupScreen onStart={setConfig} />
    </main>
  );
}

export default App;
