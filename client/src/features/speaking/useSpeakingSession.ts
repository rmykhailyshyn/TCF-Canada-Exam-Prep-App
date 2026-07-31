import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type SpeakingCompleteResult,
  type SpeakingCorrection,
  type SpeakingEvaluation,
  type SpeakingTask,
  type TaskTiming,
  completeSpeakingSession,
  createSpeakingSession,
  requestSpeakingCorrection,
  submitSpeakingResponse,
  uploadSpeakingRecording,
} from "../../lib/api";
import { useCapabilities } from "../../lib/capabilities-context";
import type { SpeakingConfig } from "./types";
import { type LocalRecording, useAudioRecorder } from "./useAudioRecorder";

// spec: docs/specs/speaking-session.md + docs/specs/speaking-ui.md
// Drives a speaking session: create, upload + transcription of each take, training submit/correct,
// and the real-mode two-phase (prep → record) per-task timers with auto-stop and auto-advance.
// Mirrors useWritingSession but with audio instead of text. The MediaRecorder capture itself lives
// in ./useAudioRecorder; the recorder's finished-take callback re-enters this hook through
// `uploadTake`, and the advance-after-upload callback is routed through a ref so it never captures
// a stale `tasks` / `sessionId`.

export type SpeakingStatus = "loading" | "error" | "active" | "finished";

// Real-mode per-task phase: prep countdown (recording disabled) → recording countdown → uploading.
export type RealPhase = "prep" | "recording" | "uploading";

export type { LocalRecording };

export type SpeakingSession = {
  status: SpeakingStatus;
  error: string | null;
  sessionId: number | null;
  mode: SpeakingConfig["mode"];
  tasks: SpeakingTask[];
  timing: TaskTiming[] | null;
  // Per-task client state, keyed by taskNumber.
  recordings: Record<number, LocalRecording>;
  transcripts: Record<number, string>;
  evaluations: Record<number, SpeakingEvaluation>;
  corrections: Record<number, SpeakingCorrection>;
  uploading: Record<number, boolean>;
  taskError: Record<number, string>;
  recordingTask: number | null;
  busyTask: number | null;
  micError: string | null;
  // Real-mode orchestration.
  currentIndex: number;
  realPhase: RealPhase;
  phaseRemainingMs: number | null;
  results: SpeakingCompleteResult | null;
  elapsedMs: number | null;
  // Actions.
  startRecording: (taskNumber: number) => void;
  stopRecording: () => void;
  submit: (taskNumber: number) => void;
  correct: (taskNumber: number) => void;
  finish: () => void;
  submitExam: () => void;
};

export function useSpeakingSession(config: SpeakingConfig): SpeakingSession {
  // spec: docs/specs/content-deploy.md §Behaviour.5 — online (aiScoring=false) never submit/correct;
  // the upload still stores the recording but the server returns an empty transcript, which is fine.
  const { aiScoring } = useCapabilities();
  const [status, setStatus] = useState<SpeakingStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<SpeakingTask[]>([]);
  const [timing, setTiming] = useState<TaskTiming[] | null>(null);
  const [transcripts, setTranscripts] = useState<Record<number, string>>({});
  const [evaluations, setEvaluations] = useState<
    Record<number, SpeakingEvaluation>
  >({});
  const [corrections, setCorrections] = useState<
    Record<number, SpeakingCorrection>
  >({});
  const [uploading, setUploading] = useState<Record<number, boolean>>({});
  const [taskError, setTaskError] = useState<Record<number, string>>({});
  const [busyTask, setBusyTask] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [realPhase, setRealPhase] = useState<RealPhase>("prep");
  const [phaseRemainingMs, setPhaseRemainingMs] = useState<number | null>(null);
  const [results, setResults] = useState<SpeakingCompleteResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  const startedRef = useRef(false);
  const startTsRef = useRef(0);
  const completedRef = useRef(false);
  const sessionIdRef = useRef<number | null>(null);
  const phaseDeadlineRef = useRef(0);
  // Mutually-referencing callbacks resolved at call time so onstop never sees a stale closure.
  const advanceRealRef = useRef<() => void>(() => {});
  const isReal = config.mode === "real";

  // spec: docs/specs/speaking-evaluation.md §Behaviour.3–5 — upload the take, store the transcript.
  const uploadTake = useCallback(
    async (taskNumber: number, blob: Blob): Promise<void> => {
      const sid = sessionIdRef.current;
      if (sid == null) return;
      setUploading((u) => ({ ...u, [taskNumber]: true }));
      setTaskError((e) => ({ ...e, [taskNumber]: "" }));
      // A new take invalidates any prior transcript/evaluation for the task.
      setEvaluations((ev) => {
        const next = { ...ev };
        delete next[taskNumber];
        return next;
      });
      try {
        const res = await uploadSpeakingRecording(sid, taskNumber, blob);
        setTranscripts((t) => ({ ...t, [taskNumber]: res.transcript }));
      } catch (err) {
        setTaskError((e) => ({
          ...e,
          [taskNumber]:
            err instanceof ApiError
              ? err.message
              : "Failed to upload / transcribe the recording.",
        }));
      } finally {
        setUploading((u) => ({ ...u, [taskNumber]: false }));
        if (isReal) advanceRealRef.current();
      }
    },
    [isReal],
  );

  const recorder = useAudioRecorder((taskNumber, blob) => {
    void uploadTake(taskNumber, blob);
  });
  const { begin: beginRecorder, isRecording, stop: stopRecording } = recorder;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createSpeakingSession(config.mode, config.taskNumbers)
      .then((res) => {
        sessionIdRef.current = res.sessionId;
        setSessionId(res.sessionId);
        setTasks(res.tasks);
        setTiming(res.timing);
        startTsRef.current = Date.now();
        setStatus("active");
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to start the speaking session.",
        );
        setStatus("error");
      });
  }, [config]);

  const timingFor = useCallback(
    (taskNumber: number): TaskTiming | undefined =>
      timing?.find((t) => t.taskNumber === taskNumber),
    [timing],
  );

  const submit = useCallback(
    (taskNumber: number) => {
      // No scoring online (aiScoring=false); the UI hides the button, this guards too.
      if (sessionId == null || busyTask != null || !aiScoring) return;
      setBusyTask(taskNumber);
      setTaskError((e) => ({ ...e, [taskNumber]: "" }));
      submitSpeakingResponse(sessionId, taskNumber)
        .then((evaluation) =>
          setEvaluations((ev) => ({ ...ev, [taskNumber]: evaluation })),
        )
        .catch((err: unknown) =>
          setTaskError((e) => ({
            ...e,
            [taskNumber]:
              err instanceof ApiError
                ? err.message
                : "Failed to score the response.",
          })),
        )
        .finally(() => setBusyTask(null));
    },
    [sessionId, busyTask, aiScoring],
  );

  const correct = useCallback(
    (taskNumber: number) => {
      // No correction endpoint online (aiScoring=false); the UI hides the button, this guards too.
      if (sessionId == null || busyTask != null || !aiScoring) return;
      setBusyTask(taskNumber);
      setTaskError((e) => ({ ...e, [taskNumber]: "" }));
      requestSpeakingCorrection(sessionId, taskNumber)
        .then((correction) =>
          setCorrections((c) => ({ ...c, [taskNumber]: correction })),
        )
        .catch((err: unknown) =>
          setTaskError((e) => ({
            ...e,
            [taskNumber]:
              err instanceof ApiError
                ? err.message
                : "Failed to get a correction.",
          })),
        )
        .finally(() => setBusyTask(null));
    },
    [sessionId, busyTask, aiScoring],
  );

  const finish = useCallback(
    (elapsed: number | null) => {
      if (completedRef.current || sessionId == null) return;
      completedRef.current = true;
      setElapsedMs(elapsed);
      completeSpeakingSession(sessionId, elapsed)
        .then((res) => {
          setResults(res);
          setStatus("finished");
        })
        .catch((err: unknown) => {
          // Allow another attempt without reloading: clear the guard so finish/submitExam can re-run.
          completedRef.current = false;
          setError(
            err instanceof ApiError
              ? err.message
              : "Failed to complete the session.",
          );
          setStatus("error");
        });
    },
    [sessionId],
  );

  const finishLearning = useCallback(() => finish(null), [finish]);
  const submitExam = useCallback(
    () => finish(Date.now() - startTsRef.current),
    [finish],
  );

  // spec: docs/specs/speaking-ui.md §Real mode (Behaviour.12–14) — advance to the next task (or
  // complete after the last), restarting the prep phase. Called after a recording uploads.
  const advanceReal = useCallback(() => {
    setCurrentIndex((idx) => {
      const next = idx + 1;
      if (next >= tasks.length) {
        finish(Date.now() - startTsRef.current);
        return idx;
      }
      setRealPhase("prep");
      return next;
    });
  }, [tasks.length, finish]);
  advanceRealRef.current = advanceReal;

  // Real-mode two-phase driver: a single interval ticks the current phase's countdown and triggers
  // the prep→record and record→stop transitions. spec: docs/specs/speaking-ui.md §Real mode.12–13.
  useEffect(() => {
    if (status !== "active" || !isReal) return;
    if (realPhase === "uploading") return;
    const task = tasks[currentIndex];
    if (!task) return;
    const t = timingFor(task.taskNumber);
    const prepMs = (t?.prepSeconds ?? 0) * 1000;
    const recordMs = (t?.recordSeconds ?? 0) * 1000;

    // Entering a phase: set its deadline once, then tick toward it.
    if (realPhase === "prep") {
      if (prepMs === 0) {
        setRealPhase("recording");
        return;
      }
      phaseDeadlineRef.current = Date.now() + prepMs;
      setPhaseRemainingMs(prepMs);
    } else if (realPhase === "recording" && !isRecording()) {
      phaseDeadlineRef.current = Date.now() + recordMs;
      setPhaseRemainingMs(recordMs);
      void beginRecorder(task.taskNumber);
    }

    const tick = (): void => {
      const remaining = phaseDeadlineRef.current - Date.now();
      if (remaining <= 0) {
        setPhaseRemainingMs(0);
        if (realPhase === "prep") {
          setRealPhase("recording");
        } else if (realPhase === "recording") {
          setRealPhase("uploading");
          stopRecording(); // onstop → upload → advanceReal
        }
      } else {
        setPhaseRemainingMs(remaining);
      }
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [
    status,
    isReal,
    realPhase,
    currentIndex,
    tasks,
    timingFor,
    beginRecorder,
    isRecording,
    stopRecording,
  ]);

  return {
    status,
    error,
    sessionId,
    mode: config.mode,
    tasks,
    timing,
    recordings: recorder.recordings,
    transcripts,
    evaluations,
    corrections,
    uploading,
    taskError,
    recordingTask: recorder.recordingTask,
    busyTask,
    micError: recorder.micError,
    currentIndex,
    realPhase,
    phaseRemainingMs,
    results,
    elapsedMs,
    startRecording: recorder.start,
    stopRecording,
    submit,
    correct,
    finish: finishLearning,
    submitExam,
  };
}
