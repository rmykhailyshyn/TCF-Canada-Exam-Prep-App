// spec: docs/specs/quiz-session.md §API contract
// Public surface of the session service. Business logic for the session lifecycle lives in the
// sibling modules; services return plain typed values or throw ApiError — the route layer owns the
// envelope. Split by lifecycle stage so no single module carries the whole flow:
//   create.ts  — question selection + session creation (POST /api/sessions)
//   answers.ts — recording an answer + completing a session
//   history.ts — the completed-session list (GET /api/sessions)
//   detail.ts  — the review read-back (GET /api/sessions/:id)

export type {
  CompleteSessionResult,
  CreateSessionInput,
  CreateSessionResult,
  Explanation,
  OptionLabel,
  QuestionResultRow,
  RecordAnswerResult,
  ReviewOption,
  SessionDetail,
  SessionQuestion,
  SessionSummary,
} from "./types";

export { createSession } from "./create";
export { completeSession, recordAnswer } from "./answers";
export { listSessions } from "./history";
export { getSession } from "./detail";
