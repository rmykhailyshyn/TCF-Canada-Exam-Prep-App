import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type CompleteResult,
  type LearningAnswerResult,
  type OptionLabel,
  type SessionQuestion,
  completeSession,
  createSession,
  submitAnswer,
} from '../../lib/api';
import type { SessionConfig } from './types';

// spec: docs/specs/quiz-session.md §Learning mode + §Real mode; docs/specs/reading-quiz-ui.md
// Drives one quiz session: creates it, tracks the current question, records answers, runs the
// real-mode countdown, and completes the session. Learning mode reveals feedback per answer;
// real mode auto-advances with no feedback.

export type QuizStatus = 'loading' | 'error' | 'active' | 'finished';

export type QuizSession = {
  status: QuizStatus;
  error: string | null;
  sessionId: number | null;
  mode: SessionConfig['mode'];
  question: SessionQuestion | undefined;
  index: number;
  total: number;
  selectedLabel: OptionLabel | null;
  feedback: LearningAnswerResult | null;
  remainingMs: number | null;
  results: CompleteResult | null;
  elapsedMs: number | null;
  submitting: boolean;
  select: (label: OptionLabel) => void;
  confirm: () => void;
  goNext: () => void;
  submitExam: () => void;
};

export function useQuizSession(config: SessionConfig): QuizSession {
  const [status, setStatus] = useState<QuizStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<SessionQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState<OptionLabel | null>(null);
  const [feedback, setFeedback] = useState<LearningAnswerResult | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [results, setResults] = useState<CompleteResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startedRef = useRef(false);
  const startTsRef = useRef(0);
  const timeLimitRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  // Create the session once (guarded against React StrictMode's double-invoke).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createSession(config)
      .then((res) => {
        setSessionId(res.sessionId);
        setQuestions(res.questions);
        timeLimitRef.current = res.timeLimitMs;
        setRemainingMs(res.timeLimitMs);
        startTsRef.current = Date.now();
        setStatus('active');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to start the session.');
        setStatus('error');
      });
  }, [config]);

  // spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
  const finish = useCallback(
    async (elapsedMs: number | null) => {
      if (completedRef.current || sessionId == null) return;
      completedRef.current = true;
      setElapsedMs(elapsedMs);
      try {
        const res = await completeSession(sessionId, elapsedMs);
        setResults(res);
        setStatus('finished');
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : 'Failed to complete the session.');
        setStatus('error');
      }
    },
    [sessionId],
  );

  const elapsedForReal = useCallback(
    () => Math.min(Date.now() - startTsRef.current, timeLimitRef.current ?? 0),
    [],
  );

  // spec: docs/specs/reading-quiz-ui.md §Learning mode feedback.13 / §Real mode.15
  const goNext = useCallback(() => {
    if (index + 1 >= questions.length) {
      void finish(config.mode === 'real' ? elapsedForReal() : null);
      return;
    }
    setFeedback(null);
    setSelectedLabel(null);
    setIndex(index + 1);
  }, [index, questions.length, config.mode, finish, elapsedForReal]);

  // spec: docs/specs/reading-quiz-ui.md §Answering.7 — pending selection, not yet recorded.
  const select = useCallback(
    (label: OptionLabel) => {
      if (feedback || submitting) return;
      setSelectedLabel(label);
    },
    [feedback, submitting],
  );

  // spec: docs/specs/reading-quiz-ui.md §Answering.10 — confirm finalises the choice.
  const confirm = useCallback(() => {
    const question = questions[index];
    if (selectedLabel == null || sessionId == null || submitting || feedback || !question) return;
    setSubmitting(true);
    submitAnswer(sessionId, question.id, selectedLabel)
      .then((res) => {
        if (config.mode === 'learning') {
          setFeedback(res as LearningAnswerResult);
        } else {
          goNext(); // real mode: no feedback, auto-advance (Behaviour.15)
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to record the answer.');
        setStatus('error');
      })
      .finally(() => setSubmitting(false));
  }, [questions, index, selectedLabel, sessionId, submitting, feedback, config.mode, goNext]);

  // spec: docs/specs/reading-quiz-ui.md §Real mode.17 — manual early submit.
  const submitExam = useCallback(() => {
    void finish(elapsedForReal());
  }, [finish, elapsedForReal]);

  // spec: docs/specs/quiz-session.md §Real mode.8,10 — countdown; auto-submit at zero.
  useEffect(() => {
    if (status !== 'active' || config.mode !== 'real' || timeLimitRef.current == null) return;
    const tick = () => {
      const remaining = (timeLimitRef.current ?? 0) - (Date.now() - startTsRef.current);
      if (remaining <= 0) {
        setRemainingMs(0);
        void finish(timeLimitRef.current);
      } else {
        setRemainingMs(remaining);
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [status, config.mode, finish]);

  return {
    status,
    error,
    sessionId,
    mode: config.mode,
    question: questions[index],
    index,
    total: questions.length,
    selectedLabel,
    feedback,
    remainingMs,
    results,
    elapsedMs,
    submitting,
    select,
    confirm,
    goNext,
    submitExam,
  };
}
