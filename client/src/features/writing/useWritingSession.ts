import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type WritingCompleteResult,
  type WritingCorrection,
  type WritingEvaluation,
  type WritingTask,
  completeWritingSession,
  createWritingSession,
  requestWritingCorrection,
  saveWritingDraft,
  submitWritingResponse,
} from '../../lib/api';
import { type WritingConfig, countWords } from './types';

// spec: docs/specs/writing-session.md + docs/specs/writing-ui.md
// Drives a writing session: create, per-task draft autosave, submit (score), on-request correction
// (training), the single real-mode countdown, and completion. Free-text — not the MCQ useQuizSession.

export type WritingStatus = 'loading' | 'error' | 'active' | 'finished';

export type WritingSession = {
  status: WritingStatus;
  error: string | null;
  sessionId: number | null;
  mode: WritingConfig['mode'];
  tasks: WritingTask[];
  drafts: Record<number, string>;
  counts: Record<number, number>;
  evaluations: Record<number, WritingEvaluation>;
  corrections: Record<number, WritingCorrection>;
  busyTask: number | null;
  taskError: Record<number, string>;
  remainingMs: number | null;
  results: WritingCompleteResult | null;
  elapsedMs: number | null;
  setDraft: (taskNumber: number, text: string) => void;
  saveNow: (taskNumber: number) => void;
  submit: (taskNumber: number) => void;
  correct: (taskNumber: number) => void;
  finish: () => void;
  submitExam: () => void;
};

export function useWritingSession(config: WritingConfig): WritingSession {
  const [status, setStatus] = useState<WritingStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<WritingTask[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [evaluations, setEvaluations] = useState<Record<number, WritingEvaluation>>({});
  const [corrections, setCorrections] = useState<Record<number, WritingCorrection>>({});
  const [busyTask, setBusyTask] = useState<number | null>(null);
  const [taskError, setTaskError] = useState<Record<number, string>>({});
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [results, setResults] = useState<WritingCompleteResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const startedRef = useRef(false);
  const startTsRef = useRef(0);
  const timeLimitRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const draftsRef = useRef<Record<number, string>>({});
  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createWritingSession(config.mode, config.taskNumbers)
      .then((res) => {
        setSessionId(res.sessionId);
        setTasks(res.tasks);
        const initial: Record<number, string> = {};
        const initialCounts: Record<number, number> = {};
        for (const t of res.tasks) {
          initial[t.taskNumber] = '';
          initialCounts[t.taskNumber] = 0;
        }
        draftsRef.current = initial;
        setDrafts(initial);
        setCounts(initialCounts);
        timeLimitRef.current = res.timeLimitMs;
        setRemainingMs(res.timeLimitMs);
        startTsRef.current = Date.now();
        setStatus('active');
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Failed to start the writing session.');
        setStatus('error');
      });
  }, [config]);

  const flushSave = useCallback(
    async (taskNumber: number) => {
      if (sessionId == null) return;
      try {
        await saveWritingDraft(sessionId, taskNumber, draftsRef.current[taskNumber] ?? '');
      } catch {
        // Autosave is best-effort; a submit re-sends the text anyway.
      }
    },
    [sessionId],
  );

  const setDraft = useCallback(
    (taskNumber: number, text: string) => {
      draftsRef.current = { ...draftsRef.current, [taskNumber]: text };
      setDrafts((d) => ({ ...d, [taskNumber]: text }));
      setCounts((c) => ({ ...c, [taskNumber]: countWords(text) }));
      if (saveTimers.current[taskNumber]) clearTimeout(saveTimers.current[taskNumber]);
      saveTimers.current[taskNumber] = setTimeout(() => void flushSave(taskNumber), 800);
    },
    [flushSave],
  );

  const saveNow = useCallback(
    (taskNumber: number) => {
      if (saveTimers.current[taskNumber]) clearTimeout(saveTimers.current[taskNumber]);
      void flushSave(taskNumber);
    },
    [flushSave],
  );

  const submit = useCallback(
    (taskNumber: number) => {
      if (sessionId == null || busyTask != null) return;
      setBusyTask(taskNumber);
      setTaskError((e) => ({ ...e, [taskNumber]: '' }));
      submitWritingResponse(sessionId, taskNumber, draftsRef.current[taskNumber] ?? '')
        .then((evaluation) => setEvaluations((ev) => ({ ...ev, [taskNumber]: evaluation })))
        .catch((err: unknown) =>
          setTaskError((e) => ({
            ...e,
            [taskNumber]: err instanceof ApiError ? err.message : 'Failed to score the response.',
          })),
        )
        .finally(() => setBusyTask(null));
    },
    [sessionId, busyTask],
  );

  const correct = useCallback(
    (taskNumber: number) => {
      if (sessionId == null || busyTask != null) return;
      setBusyTask(taskNumber);
      setTaskError((e) => ({ ...e, [taskNumber]: '' }));
      requestWritingCorrection(sessionId, taskNumber, draftsRef.current[taskNumber] ?? '')
        .then((correction) => setCorrections((c) => ({ ...c, [taskNumber]: correction })))
        .catch((err: unknown) =>
          setTaskError((e) => ({
            ...e,
            [taskNumber]: err instanceof ApiError ? err.message : 'Failed to get a correction.',
          })),
        )
        .finally(() => setBusyTask(null));
    },
    [sessionId, busyTask],
  );

  const finish = useCallback(
    (elapsed: number | null) => {
      if (completedRef.current || sessionId == null) return;
      completedRef.current = true;
      setElapsedMs(elapsed);
      completeWritingSession(sessionId, elapsed)
        .then((res) => {
          setResults(res);
          setStatus('finished');
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiError ? err.message : 'Failed to complete the session.');
          setStatus('error');
        });
    },
    [sessionId],
  );

  const finishLearning = useCallback(() => finish(null), [finish]);
  const submitExam = useCallback(
    () => finish(Math.min(Date.now() - startTsRef.current, timeLimitRef.current ?? 0)),
    [finish],
  );

  // Real-mode countdown with auto-submit (spec: writing-ui §Real mode.15).
  useEffect(() => {
    if (status !== 'active' || config.mode !== 'real' || timeLimitRef.current == null) return;
    const tick = (): void => {
      const remaining = (timeLimitRef.current ?? 0) - (Date.now() - startTsRef.current);
      if (remaining <= 0) {
        setRemainingMs(0);
        finish(timeLimitRef.current);
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
    tasks,
    drafts,
    counts,
    evaluations,
    corrections,
    busyTask,
    taskError,
    remainingMs,
    results,
    elapsedMs,
    setDraft,
    saveNow,
    submit,
    correct,
    finish: finishLearning,
    submitExam,
  };
}
