import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { BrandMark } from './components/BrandMark';
import { SetupScreen } from './features/quiz/SetupScreen';
import type { SessionConfig } from './features/quiz/types';
import { HistoryPage } from './pages/HistoryPage';
import { ListeningQuizPage } from './pages/ListeningQuizPage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { ReadingQuizPage } from './pages/ReadingQuizPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

// spec: docs/specs/reading-quiz-ui.md + docs/specs/listening-quiz-ui.md + docs/specs/progress-tracking.md §Behaviour.4
// Home shows the setup screen until a session is configured, then the reading or listening quiz
// page (by chosen section); "Back to home" / completion clears the config. A React Router
// (introduced in Milestone 4) adds session-history navigation (History link → /history).

function Home(): JSX.Element {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const navigate = useNavigate();

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
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/70 bg-white/80 px-6 py-3 backdrop-blur-md">
        <BrandMark />
        <nav className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/question-bank')}
            className="text-sm text-sky-600 transition hover:text-sky-700"
          >
            Question Bank
          </button>
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="text-sm text-sky-600 transition hover:text-sky-700"
          >
            History
          </button>
        </nav>
      </header>
      <SetupScreen onStart={setConfig} />
    </main>
  );
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/question-bank" element={<QuestionBankPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:id" element={<SessionDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
