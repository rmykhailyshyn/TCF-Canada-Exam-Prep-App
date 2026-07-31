import type { DifficultySlug } from "../../lib/bands";
import type { Section } from "../../config/exam";

// spec: docs/specs/quiz-session.md §API contract
// Shared DTOs for the session lifecycle (create → answer → complete) and its read-back endpoints
// (history + review). Pure types only — the queries live alongside in create/answers/history/detail.

export type OptionLabel = "A" | "B" | "C" | "D";

// UI-facing question shape: deliberately omits `is_correct` so the answer key never leaks to
// the client before the answer is confirmed (the correct label comes from recordAnswer).
export type SessionQuestion = {
  id: number;
  sequence: number;
  text: string;
  passage: { id: number; text: string } | null;
  options: { label: OptionLabel; text: string }[];
};

export type CreateSessionInput = {
  section: Section;
  mode: "learning" | "real";
  difficulty?: DifficultySlug;
  questionIds?: number[];
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

export type RecordAnswerResult =
  | {
      mode: "learning";
      isCorrect: boolean;
      correctLabel: OptionLabel;
      explanation: Explanation | null;
    }
  | { mode: "real" };

export type CompleteSessionResult = {
  correct: number;
  total: number;
  pointsScored: number | null;
  pointsPossible: number | null;
};

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
// `overallScore` / `tasksSubmitted` are populated for writing sessions (mean per-task /20 + answered
// count) and null for reading/listening; `correct` / `total` / points are the reverse.
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
  overallScore: number | null;
  tasksSubmitted: number | null;
  elapsedMs: number | null;
};

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions/:id
// spec: docs/specs/review-mode.md §Behaviour.4–6 — review mode consumes this endpoint, so each
// per-question result carries the full content needed to render the review (question text, passage
// excerpt, all four options, the chosen + correct labels) plus the derived difficulty band (for
// retry grouping) and the LLM explanation — the latter only in learning mode (Behaviour.6).
export type ReviewOption = { label: OptionLabel; text: string };

export type QuestionResultRow = {
  id: number;
  questionId: number;
  sequence: number;
  text: string;
  passage: { text: string } | null;
  options: ReviewOption[];
  chosenLabel: string;
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
