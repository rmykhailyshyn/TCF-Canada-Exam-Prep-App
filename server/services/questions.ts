import { extname } from "node:path";
import { asc, eq } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import {
  audioFiles,
  passages,
  questions,
  transcriptSegments,
} from "../db/schema";
import { ApiError } from "../lib/errors";

// spec: docs/specs/listening-player.md §API contract
// Business logic for the listening player's read endpoints. Services return plain typed values or
// throw ApiError; the route layer owns the envelope (and, for audio/images, the byte stream).
// spec: docs/specs/server-runtime.md §Behaviour.5, 6 — the DB is injected (no singleton) and these
// functions return the STORED media key (the path the MediaStore resolves), not an absolute path.

export type AudioFileInfo = {
  // The stored, MediaStore-resolvable key (e.g. `listening/30q2.mp3`, or a legacy absolute path).
  key: string;
  durationMs: number | null;
};

export type TranscriptSegmentDto = {
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type PassageImageInfo = {
  // The stored, MediaStore-resolvable key (e.g. `reading/…Q39.png`, or a legacy absolute path).
  key: string;
  contentType: string;
};

// spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
// Returns the stored passage-image key for a reading question's linked passage. Throws
// PASSAGE_IMAGE_NOT_FOUND when the question has no passage (a listening question, or an unknown id).
// The route resolves the bytes through the MediaStore. The contentType is derived from the key's
// extension so the route does not need to re-inspect the path.
export async function getPassageImage(
  db: DbClient,
  questionId: number,
): Promise<PassageImageInfo> {
  const [row] = await db
    .select({ sourceFile: passages.sourceFile })
    .from(questions)
    .innerJoin(passages, eq(questions.passageId, passages.id))
    .where(eq(questions.id, questionId));
  if (!row) {
    throw new ApiError(
      "PASSAGE_IMAGE_NOT_FOUND",
      `No passage image for question ${questionId}.`,
      404,
    );
  }
  const contentType = /\.jpe?g$/i.test(extname(row.sourceFile))
    ? "image/jpeg"
    : "image/png";
  return { key: row.sourceFile, contentType };
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio
// Returns the stored MP3 key for a question. Throws NOT_FOUND when the question has no audio (e.g. a
// reading question, or an unknown id). The route streams the file through the MediaStore with range
// support.
export async function getAudioFile(
  db: DbClient,
  questionId: number,
): Promise<AudioFileInfo> {
  const [row] = await db
    .select({
      filePath: audioFiles.filePath,
      durationMs: audioFiles.durationMs,
    })
    .from(audioFiles)
    .where(eq(audioFiles.questionId, questionId));
  if (!row) {
    throw new ApiError(
      "NOT_FOUND",
      `No audio found for question ${questionId}.`,
      404,
    );
  }
  return { key: row.filePath, durationMs: row.durationMs };
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/transcript
// Returns the question's phrase-level segments ordered by sequence. An unknown question id is a
// NOT_FOUND; a known question with no segments returns an empty list.
export async function getTranscript(
  db: DbClient,
  questionId: number,
): Promise<TranscriptSegmentDto[]> {
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.id, questionId));
  if (!question) {
    throw new ApiError("NOT_FOUND", `Question ${questionId} not found.`, 404);
  }

  return db
    .select({
      sequence: transcriptSegments.sequence,
      text: transcriptSegments.text,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.questionId, questionId))
    .orderBy(asc(transcriptSegments.sequence));
}
