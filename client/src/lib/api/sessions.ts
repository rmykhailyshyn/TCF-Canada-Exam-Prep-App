import { get, request } from "./http";
import type {
  DifficultySlug,
  Explanation,
  Mode,
  OptionLabel,
  Section,
} from "./types";

// spec: docs/specs/quiz-session.md + docs/specs/progress-tracking.md + docs/specs/review-mode.md
// Typed client for the reading/listening session endpoints: create, answer, complete, plus the
// history list and the per-session review read-back.

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
