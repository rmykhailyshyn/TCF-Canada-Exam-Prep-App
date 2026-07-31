// spec: docs/specs/quiz-session.md §API contract
// Public surface of the typed backend client. Every call unwraps the standard { data, error }
// envelope and throws ApiError on a failure envelope so callers can branch on error.code.
// Split by endpoint group so no single module carries the whole API:
//   http.ts         — transport + ApiError
//   types.ts        — vocabulary shared across groups
//   capabilities.ts — GET /api/health capability gating
//   sessions.ts     — reading/listening sessions + history + review
//   questions.ts    — per-question media/transcript + question-bank export/import
//   writing.ts      — writing sessions, drafts, submit/correct/complete
//   speaking.ts     — speaking sessions, recording upload, submit/correct/complete

export { ApiError } from "./http";
export type {
  DifficultySlug,
  Explanation,
  Mode,
  OptionLabel,
  Section,
} from "./types";
export type { Capabilities } from "./capabilities";
export { fetchCapabilities } from "./capabilities";
export type {
  CompleteResult,
  CreateSessionInput,
  CreateSessionResult,
  LearningAnswerResult,
  QuestionResultRow,
  RealAnswerResult,
  SessionDetail,
  SessionQuestion,
  SessionSummary,
} from "./sessions";
export {
  completeSession,
  createSession,
  fetchSession,
  fetchSessions,
  submitAnswer,
} from "./sessions";
export type {
  DifficultyFilter,
  ExportDocument,
  ExportQuestion,
  ImportSummary,
  SectionFilter,
  TranscriptSegment,
} from "./questions";
export {
  audioUrl,
  fetchExport,
  fetchTranscript,
  importQuestions,
  passageImageUrl,
} from "./questions";
export type {
  CreateWritingSessionResult,
  WritingCompleteResult,
  WritingCorrection,
  WritingEvaluation,
  WritingFeedback,
  WritingMode,
  WritingSessionDetail,
  WritingTask,
  WritingTaskReview,
} from "./writing";
export {
  completeWritingSession,
  createWritingSession,
  fetchWritingSession,
  requestWritingCorrection,
  saveWritingDraft,
  submitWritingResponse,
} from "./writing";
export type {
  CreateSpeakingSessionResult,
  SpeakingCompleteResult,
  SpeakingCorrection,
  SpeakingEvaluation,
  SpeakingFeedback,
  SpeakingMode,
  SpeakingSessionDetail,
  SpeakingTask,
  SpeakingTaskReview,
  SpeakingUploadResult,
  TaskTiming,
} from "./speaking";
export {
  completeSpeakingSession,
  createSpeakingSession,
  fetchSpeakingSession,
  requestSpeakingCorrection,
  speakingAudioUrl,
  submitSpeakingResponse,
  uploadSpeakingRecording,
} from "./speaking";
