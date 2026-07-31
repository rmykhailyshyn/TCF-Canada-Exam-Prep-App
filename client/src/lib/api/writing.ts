import { get, request, send } from "./http";

// ============================================================================
// Writing section (Milestone 10)
// spec: docs/specs/writing-session.md §API contract + docs/specs/writing-evaluation.md
// ============================================================================

export type WritingMode = "learning" | "real";

export type WritingTask = {
  taskId: number;
  taskNumber: number;
  title: string | null;
  prompt: string;
  instructions: string | null;
  minWords: number | null;
  maxWords: number | null;
  sampleAnswer?: string | null;
  template?: string | null;
};

export type CreateWritingSessionResult = {
  sessionId: number;
  mode: WritingMode;
  tasks: WritingTask[];
  timeLimitMs: number | null;
};

export type WritingFeedback = {
  strengths: string;
  errors: string;
  improvements: string;
};
export type WritingEvaluation = {
  score: number;
  level: string;
  feedback: WritingFeedback;
};
export type WritingCorrection = {
  correctedText: string;
  suggestions: string[];
};

export type WritingCompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  // Online (practice-only) completion produces no fabricated /20 — overallScore is null.
  overallScore: number | null;
  submitted: number;
};

export type WritingTaskReview = {
  taskNumber: number;
  title: string | null;
  prompt: string;
  instructions: string | null;
  minWords: number | null;
  maxWords: number | null;
  sampleAnswer: string | null;
  template: string | null;
  responseText: string;
  wordCount: number | null;
  submitted: boolean;
  score: number | null;
  level: string | null;
  feedback: WritingFeedback | null;
};

export type WritingSessionDetail = {
  session: {
    id: number;
    mode: string;
    completedAt: string | null;
    elapsedMs: number | null;
    overallScore: number | null;
    submitted: number;
  };
  tasks: WritingTaskReview[];
};

export function createWritingSession(
  mode: WritingMode,
  taskNumbers?: number[],
): Promise<CreateWritingSessionResult> {
  return request<CreateWritingSessionResult>("/api/writing/sessions", {
    mode,
    taskNumbers,
  });
}

export function saveWritingDraft(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<{ wordCount: number }> {
  return send<{ wordCount: number }>(
    "PUT",
    `/api/writing/sessions/${sessionId}/responses/${taskNumber}`,
    { text },
  );
}

// spec: docs/specs/content-deploy.md §Behaviour.4 — online (aiScoring=false) the submit locks the
// response WITHOUT producing an evaluation: the server returns score=null, so resolve to null.
export async function submitWritingResponse(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<WritingEvaluation | null> {
  const res = await request<{
    score: number | null;
    level: string | null;
    feedback: WritingFeedback | null;
  }>(`/api/writing/sessions/${sessionId}/responses/${taskNumber}/submit`, {
    text,
  });
  if (res.score == null || res.level == null || res.feedback == null)
    return null;
  return { score: res.score, level: res.level, feedback: res.feedback };
}

export function requestWritingCorrection(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<WritingCorrection> {
  return request<WritingCorrection>(
    `/api/writing/sessions/${sessionId}/correct/${taskNumber}`,
    {
      text,
    },
  );
}

export function completeWritingSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<WritingCompleteResult> {
  return request<WritingCompleteResult>(
    `/api/writing/sessions/${sessionId}/complete`,
    { elapsedMs },
  );
}

export function fetchWritingSession(
  sessionId: number,
): Promise<WritingSessionDetail> {
  return get<WritingSessionDetail>(`/api/writing/sessions/${sessionId}`);
}
