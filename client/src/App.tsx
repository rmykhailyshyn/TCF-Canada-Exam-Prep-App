import { useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { TopNav } from './components/TopNav';
import { SetupScreen } from './features/quiz/SetupScreen';
import type { SessionConfig } from './features/quiz/types';
import { HistoryPage } from './pages/HistoryPage';
import { ListeningQuizPage } from './pages/ListeningQuizPage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { ReadingQuizPage } from './pages/ReadingQuizPage';
import { ReviewPage } from './pages/ReviewPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { SpeakingPage } from './pages/SpeakingPage';
import { SpeakingReviewPage } from './pages/SpeakingReviewPage';
import { WritingPage } from './pages/WritingPage';
import { WritingReviewPage } from './pages/WritingReviewPage';

// spec: docs/specs/reading-quiz-ui.md + docs/specs/listening-quiz-ui.md + docs/specs/progress-tracking.md §Behaviour.4
// Home shows the setup screen until a session is configured, then the reading or listening quiz
// page (by chosen section); "Back to home" / completion clears the config. A React Router
// (introduced in Milestone 4) adds session-history navigation (History link → /history).

function Home(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  // spec: docs/specs/review-mode.md §Behaviour.8–10 — a retry from review mode arrives as a
  // SessionConfig (band difficulty + that band's incorrect questionIds) in the navigation state.
  const retryConfig = (location.state as { retryConfig?: SessionConfig } | null)?.retryConfig ?? null;
  const [config, setConfig] = useState<SessionConfig | null>(retryConfig);

  if (config) {
    const onExit = () => {
      setConfig(null);
      if (location.state) navigate('/', { replace: true, state: null });
    };
    return config.section === 'listening' ? (
      <ListeningQuizPage config={config} onExit={onExit} />
    ) : (
      <ReadingQuizPage config={config} onExit={onExit} />
    );
  }

  // spec: docs/specs/section-navigation.md §Behaviour.1–2 — the landing shows the persistent top menu
  // and the four-section picker. No active section is highlighted here (the user is not yet inside one).
  return (
    <>
      <TopNav />
      <main className="min-h-screen">
        <SetupScreen onStart={setConfig} />
      </main>
    </>
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
        <Route path="/review/:id" element={<ReviewPage />} />
        <Route path="/writing" element={<WritingPage />} />
        <Route path="/writing/:id" element={<WritingReviewPage />} />
        <Route path="/speaking" element={<SpeakingPage />} />
        <Route path="/speaking/:id" element={<SpeakingReviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
