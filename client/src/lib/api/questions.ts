import { get, request } from "./http";
import type { DifficultySlug, OptionLabel, Section } from "./types";

// spec: docs/specs/listening-player.md + docs/specs/reading-quiz-ui.md + docs/specs/question-export-import.md
// Per-question media (audio / passage image / transcript) and the question-bank export + import.

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
