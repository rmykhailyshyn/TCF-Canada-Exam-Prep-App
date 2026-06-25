// spec: docs/specs/quiz-session.md §API contract
// Typed client for the session endpoints. Unwraps the standard { data, error } envelope and
// throws ApiError on a failure envelope so callers can branch on error.code.

export type OptionLabel = "A" | "B" | "C" | "D";
export type Section = "reading" | "listening";
export type Mode = "learning" | "real";
export type DifficultySlug =
  | "beginner"
  | "elementary"
  | "intermediate"
  | "upper-intermediate"
  | "advanced"
  | "expert";

export type SessionQuestion = {
  id: number;
  sequence: number;
  text: string;
  passage: { id: number; text: string } | null;
  options: { label: OptionLabel; text: string }[];
};

export type CreateSessionResult = {
  sessionId: number;
  questions: SessionQuestion[];
  timeLimitMs: number | null;
};

export type Explanation = {
  correctReason: string;
  optionAReason: string;
  optionBReason: string;
  optionCReason: string;
  optionDReason: string;
};

export type LearningAnswerResult = {
  isCorrect: boolean;
  correctLabel: OptionLabel;
  explanation: Explanation | null;
};

export type RealAnswerResult = { recorded: true };

export type CompleteResult = {
  correct: number;
  total: number;
  pointsScored: number | null;
  pointsPossible: number | null;
};

type Envelope<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  return envelope.data;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  return envelope.data;
}

export type CreateSessionInput = {
  section: Section;
  mode: Mode;
  difficulty?: DifficultySlug;
  questionIds?: number[];
};

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
export type SessionSummary = {
  id: number;
  section: string;
  mode: string;
  difficulty: string | null;
  completedAt: string;
  correct: number;
  total: number;
  pointsScored: number | null;
  pointsPossible: number | null;
  // Writing sessions only (null for reading/listening): mean per-task /20 + answered-task count.
  overallScore: number | null;
  tasksSubmitted: number | null;
  elapsedMs: number | null;
};

// spec: docs/specs/review-mode.md §Behaviour.4–6 — per-question review content carried on the
// session-detail endpoint (question text + passage excerpt, all four options, chosen + correct
// labels, the derived difficulty band for retry grouping, and the learning-mode-only explanation).
export type QuestionResultRow = {
  id: number;
  questionId: number;
  sequence: number;
  text: string;
  passage: { text: string } | null;
  options: { label: OptionLabel; text: string }[];
  chosenLabel: OptionLabel;
  correctLabel: OptionLabel | null;
  isCorrect: boolean;
  difficulty: DifficultySlug | null;
  explanation: Explanation | null;
  answeredAt: string;
};

export type SessionDetail = {
  session: SessionSummary;
  results: QuestionResultRow[];
};

export function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  return get<{ sessions: SessionSummary[] }>("/api/sessions");
}

export function fetchSession(id: number): Promise<SessionDetail> {
  return get<SessionDetail>(`/api/sessions/${id}`);
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
export function createSession(
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  return request<CreateSessionResult>("/api/sessions", input);
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
export function submitAnswer(
  sessionId: number,
  questionId: number,
  chosenLabel: OptionLabel,
): Promise<LearningAnswerResult | RealAnswerResult> {
  return request<LearningAnswerResult | RealAnswerResult>(
    `/api/sessions/${sessionId}/answers`,
    {
      questionId,
      chosenLabel,
    },
  );
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
export function completeSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  return request<CompleteResult>(`/api/sessions/${sessionId}/complete`, {
    elapsedMs,
  });
}

// spec: docs/specs/listening-player.md §API contract
export type TranscriptSegment = {
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
};

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio
// The <audio> element's src; the server streams the MP3 with range support for seeking.
export function audioUrl(questionId: number): string {
  return `/api/questions/${questionId}/audio`;
}

// spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
// The <img> element's src for a reading question's passage image. The server streams the file;
// a 404 (no passage / missing on disk) fires the img's error event so the UI falls back to text.
export function passageImageUrl(questionId: number): string {
  return `/api/questions/${questionId}/passage-image`;
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/transcript
export function fetchTranscript(
  questionId: number,
): Promise<{ segments: TranscriptSegment[] }> {
  return get<{ segments: TranscriptSegment[] }>(
    `/api/questions/${questionId}/transcript`,
  );
}

// spec: docs/specs/question-export-import.md §Export document format + API contract
export type SectionFilter = "reading" | "listening" | "all";
export type DifficultyFilter = DifficultySlug[] | "all";

export type ExportQuestion = {
  section: Section;
  sourceFile: string;
  sequence: number;
  difficulty: DifficultySlug | null;
  text: string;
  options: { label: OptionLabel; text: string; isCorrect: boolean }[];
  passage: { sourceFile: string; text: string } | null;
  audio: { fileName: string; durationMs: number | null } | null;
  transcript: {
    sequence: number;
    text: string;
    startMs: number;
    endMs: number;
  }[];
};

export type ExportDocument = {
  formatVersion: number;
  exportedAt: string;
  filter: { section: SectionFilter; difficulties: DifficultyFilter };
  questions: ExportQuestion[];
};

export type ImportSummary = {
  inserted: number;
  overridden: number;
  skipped: number;
  total: number;
  warnings: string[];
};

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
export function fetchExport(
  section: SectionFilter,
  difficulties: DifficultyFilter,
): Promise<ExportDocument> {
  const params = new URLSearchParams({ section });
  params.set(
    "difficulty",
    difficulties === "all" ? "all" : difficulties.join(","),
  );
  return get<ExportDocument>(`/api/questions/export?${params.toString()}`);
}

// spec: docs/specs/question-export-import.md §API contract POST /api/questions/import
export function importQuestions(
  document: ExportDocument,
  override: boolean,
): Promise<ImportSummary> {
  return request<ImportSummary>("/api/questions/import", {
    document,
    override,
  });
}

// ============================================================================
// Writing section (Milestone 10)
// spec: docs/specs/writing-session.md §API contract + docs/specs/writing-evaluation.md
// ============================================================================

async function send<T>(
  method: "PUT" | "POST",
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error)
    throw new ApiError(envelope.error.code, envelope.error.message);
  return envelope.data;
}

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
  overallScore: number;
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

export function submitWritingResponse(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<WritingEvaluation> {
  return request<WritingEvaluation>(
    `/api/writing/sessions/${sessionId}/responses/${taskNumber}/submit`,
    { text },
  );
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
  overallScore: number;
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
  const envelope = (await res.json()) as Envelope<SpeakingUploadResult>;
  if (envelope.error)
    throw new ApiError(envelope.error.code, envelope.error.message);
  return envelope.data;
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
