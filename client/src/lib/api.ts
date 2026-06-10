// spec: docs/specs/quiz-session.md §API contract
// Typed client for the session endpoints. Unwraps the standard { data, error } envelope and
// throws ApiError on a failure envelope so callers can branch on error.code.

export type OptionLabel = 'A' | 'B' | 'C' | 'D';
export type Section = 'reading' | 'listening';
export type Mode = 'learning' | 'real';
export type DifficultySlug =
  | 'beginner'
  | 'elementary'
  | 'intermediate'
  | 'upper-intermediate'
  | 'advanced'
  | 'expert';

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

type Envelope<T> = { data: T; error: null } | { data: null; error: { code: string; message: string } };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
  elapsedMs: number | null;
};

export type QuestionResultRow = {
  id: number;
  questionId: number;
  chosenLabel: string;
  isCorrect: boolean;
  answeredAt: string;
};

export type SessionDetail = {
  session: SessionSummary;
  results: QuestionResultRow[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const envelope = (await res.json()) as Envelope<T>;
  if (envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message);
  }
  return envelope.data;
}

export function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  return get<{ sessions: SessionSummary[] }>('/api/sessions');
}

export function fetchSession(id: number): Promise<SessionDetail> {
  return get<SessionDetail>(`/api/sessions/${id}`);
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
export function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  return request<CreateSessionResult>('/api/sessions', input);
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
export function submitAnswer(
  sessionId: number,
  questionId: number,
  chosenLabel: OptionLabel,
): Promise<LearningAnswerResult | RealAnswerResult> {
  return request<LearningAnswerResult | RealAnswerResult>(`/api/sessions/${sessionId}/answers`, {
    questionId,
    chosenLabel,
  });
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
export function completeSession(sessionId: number, elapsedMs: number | null): Promise<CompleteResult> {
  return request<CompleteResult>(`/api/sessions/${sessionId}/complete`, { elapsedMs });
}
