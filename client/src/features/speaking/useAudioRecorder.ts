import { useCallback, useEffect, useRef, useState } from "react";
import { preferredAudioMime } from "./types";

// spec: docs/specs/speaking-ui.md §Recorder (Behaviour.5–7)
// In-browser voice capture (getUserMedia + MediaRecorder) for one task at a time: permission
// handling, per-task blob URLs for local playback, and the finished-take handoff. Extracted from
// useSpeakingSession so that hook is left with the session/timing orchestration alone.
// The finished-take callback is routed through a ref so the MediaRecorder `onstop` closure never
// sees a stale caller (it is registered once, when recording starts).

export type LocalRecording = { url: string };

export type AudioRecorder = {
  // Per-task blob URLs of the latest take, keyed by taskNumber.
  recordings: Record<number, LocalRecording>;
  recordingTask: number | null;
  micError: string | null;
  // Whether a take is currently being captured — read from a ref, so it is safe to call inside an
  // effect without adding a re-render dependency.
  isRecording: () => boolean;
  // Start capturing; resolves false when microphone permission was refused.
  begin: (taskNumber: number) => Promise<boolean>;
  // Fire-and-forget `begin`, ignored while another take is in progress.
  start: (taskNumber: number) => void;
  stop: () => void;
};

export function useAudioRecorder(
  onTake: (taskNumber: number, blob: Blob) => void,
): AudioRecorder {
  const [recordings, setRecordings] = useState<Record<number, LocalRecording>>(
    {},
  );
  const [recordingTask, setRecordingTask] = useState<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTaskRef = useRef<number | null>(null);
  // Mirror of `recordings` so the unmount cleanup (empty deps) can revoke every blob URL it holds.
  const recordingsRef = useRef<Record<number, LocalRecording>>({});
  recordingsRef.current = recordings;
  const onTakeRef = useRef(onTake);
  onTakeRef.current = onTake;

  // Stop any live stream/recorder and release every captured blob URL on unmount.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      for (const rec of Object.values(recordingsRef.current)) {
        URL.revokeObjectURL(rec.url);
      }
    };
  }, []);

  const begin = useCallback(async (taskNumber: number): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      const mime = preferredAudioMime();
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const url = URL.createObjectURL(blob);
        setRecordings((r) => {
          const prev = r[taskNumber];
          if (prev) URL.revokeObjectURL(prev.url);
          return { ...r, [taskNumber]: { url } };
        });
        onTakeRef.current(taskNumber, blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      recordingTaskRef.current = taskNumber;
      setRecordingTask(taskNumber);
      setMicError(null);
      return true;
    } catch {
      setMicError(
        "Microphone access was denied. Allow it in your browser and try again.",
      );
      return false;
    }
  }, []);

  const start = useCallback(
    (taskNumber: number) => {
      if (recordingTaskRef.current != null) return;
      void begin(taskNumber);
    },
    [begin],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recordingTaskRef.current = null;
    setRecordingTask(null);
    if (!recorder) return;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const isRecording = useCallback(() => recordingTaskRef.current != null, []);

  return {
    recordings,
    recordingTask,
    micError,
    isRecording,
    begin,
    start,
    stop,
  };
}
