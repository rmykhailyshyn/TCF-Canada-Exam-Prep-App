import { useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { SetupScreen } from './features/quiz/SetupScreen';
import type { SessionConfig } from './features/quiz/types';
import { HistoryPage } from './pages/HistoryPage';
import { ReadingQuizPage } from './pages/ReadingQuizPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

// spec: docs/specs/progress-tracking.md §Behaviour.4 — history accessible from navigation menu.
// Router introduced in Milestone 4; previously used useState for navigation.

function Home(): JSX.Element {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const navigate = useNavigate();

  if (config) {
    return <ReadingQuizPage config={config} onExit={() => setConfig(null)} />;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
        <span className="font-semibold text-slate-900">TCF Canada Prep</span>
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="text-sm text-sky-600 hover:text-sky-700 transition"
        >
          History
        </button>
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
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:id" element={<SessionDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
