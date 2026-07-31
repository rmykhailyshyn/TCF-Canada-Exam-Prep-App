import { get, request, unwrap } from "./http";

// ============================================================================
// Speaking section (Milestone 11)
// spec: docs/specs/speaking-session.md §API contract + docs/specs/speaking-evaluation.md
// ============================================================================

export type SpeakingMode = "learning" | "real";

// spec: docs/specs/speaking-session.md §API contract — per-task prep + recording limits (real mode).
export type TaskTiming = {
  taskNumber: number;
  prepSeconds: number;
  recordSeconds: number;
};

export type SpeakingTask = {
  taskId: number;
  taskNumber: number;
  question: string;
  sampleAnswer?: string | null;
};

export type CreateSpeakingSessionResult = {
  sessionId: number;
  mode: SpeakingMode;
  tasks: SpeakingTask[];
  timing: TaskTiming[] | null;
};

export type SpeakingFeedback = {
  strengths: string;
  errors: string;
  improvements: string;
};
export type SpeakingEvaluation = {
  score: number;
  level: string;
  feedback: SpeakingFeedback;
};
export type SpeakingCorrection = {
  correctedText: string;
  suggestions: string[];
};
export type SpeakingUploadResult = {
  transcript: string;
  audioUrl: string;
  durationMs: number | null;
};

export type SpeakingCompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  // Online (practice-only) completion produces no fabricated /20 — overallScore is null.
  overallScore: number | null;
  submitted: number;
};

export type SpeakingTaskReview = {
  taskNumber: number;
  question: string;
  sampleAnswer: string | null;
  transcript: string | null;
  durationMs: number | null;
  hasAudio: boolean;
  audioUrl: string | null;
  submitted: boolean;
  score: number | null;
  level: string | null;
  feedback: SpeakingFeedback | null;
};

export type SpeakingSessionDetail = {
  session: {
    id: number;
    mode: string;
    completedAt: string | null;
    elapsedMs: number | null;
    overallScore: number | null;
    submitted: number;
  };
  tasks: SpeakingTaskReview[];
};

// spec: docs/specs/speaking-session.md §API contract POST /api/speaking/sessions
export function createSpeakingSession(
  mode: SpeakingMode,
  taskNumbers?: number[],
): Promise<CreateSpeakingSessionResult> {
  return request<CreateSpeakingSessionResult>("/api/speaking/sessions", {
    mode,
    taskNumbers,
  });
}

// spec: docs/specs/speaking-session.md §API contract POST …/responses/:taskNumber — upload + transcribe.
export async function uploadSpeakingRecording(
  sessionId: number,
  taskNumber: number,
  audio: Blob,
): Promise<SpeakingUploadResult> {
  const form = new FormData();
  // The filename hints the server at the container; MIME comes from the Blob's type.
  const ext = audio.type.includes("ogg")
    ? "ogg"
    : audio.type.includes("mp4")
      ? "m4a"
      : "webm";
  form.append("audio", audio, `recording.${ext}`);
  const res = await fetch(
    `/api/speaking/sessions/${sessionId}/responses/${taskNumber}`,
    {
      method: "POST",
      body: form,
    },
  );
  return unwrap<SpeakingUploadResult>(res);
}

// spec: docs/specs/speaking-session.md §API contract POST …/responses/:taskNumber/submit
export function submitSpeakingResponse(
  sessionId: number,
  taskNumber: number,
): Promise<SpeakingEvaluation> {
  return request<SpeakingEvaluation>(
    `/api/speaking/sessions/${sessionId}/responses/${taskNumber}/submit`,
    {},
  );
}

// spec: docs/specs/speaking-session.md §API contract POST …/correct/:taskNumber (training only)
export function requestSpeakingCorrection(
  sessionId: number,
  taskNumber: number,
): Promise<SpeakingCorrection> {
  return request<SpeakingCorrection>(
    `/api/speaking/sessions/${sessionId}/correct/${taskNumber}`,
    {},
  );
}

// spec: docs/specs/speaking-session.md §API contract POST /api/speaking/sessions/:id/complete
export function completeSpeakingSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<SpeakingCompleteResult> {
  return request<SpeakingCompleteResult>(
    `/api/speaking/sessions/${sessionId}/complete`,
    {
      elapsedMs,
    },
  );
}

// spec: docs/specs/speaking-session.md §API contract GET /api/speaking/sessions/:id
export function fetchSpeakingSession(
  sessionId: number,
): Promise<SpeakingSessionDetail> {
  return get<SpeakingSessionDetail>(`/api/speaking/sessions/${sessionId}`);
}

// spec: docs/specs/speaking-session.md §API contract GET …/responses/:taskNumber/audio
// The <audio> element's src; the server streams the recording with range support for seeking.
export function speakingAudioUrl(
  sessionId: number,
  taskNumber: number,
): string {
  return `/api/speaking/sessions/${sessionId}/responses/${taskNumber}/audio`;
}
