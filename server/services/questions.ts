import { isAbsolute, extname, resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { audioFiles, passages, questions, transcriptSegments } from '../db/schema';
import { ApiError } from '../lib/errors';
import { getMediaDir } from '../config/env';

// spec: docs/specs/listening-player.md §API contract
// Business logic for the listening player's two read endpoints. Services return plain typed values
// or throw ApiError; the route layer owns the envelope (and, for audio, the byte stream).

export type AudioFileInfo = {
  filePath: string;
  durationMs: number | null;
};

export type TranscriptSegmentDto = {
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type PassageImageInfo = {
  filePath: string;
  contentType: string;
};

// spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
// Resolves the original passage image path for a reading question's linked passage. Throws
// PASSAGE_IMAGE_NOT_FOUND when the question has no passage (a listening question, or an unknown
// id). The stored `passages.source_file` may be absolute (real OCR import) or a bare basename
// (dev seed / export-import); a relative path is resolved against MEDIA_DIR, mirroring audio.
export async function getPassageImage(questionId: number): Promise<PassageImageInfo> {
  const [row] = await db
    .select({ sourceFile: passages.sourceFile })
    .from(questions)
    .innerJoin(passages, eq(questions.passageId, passages.id))
    .where(eq(questions.id, questionId));
  if (!row) {
    throw new ApiError(
      'PASSAGE_IMAGE_NOT_FOUND',
      `No passage image for question ${questionId}.`,
      404,
    );
  }
  const filePath = isAbsolute(row.sourceFile)
    ? row.sourceFile
    : resolve(getMediaDir(), row.sourceFile);
  const contentType = /\.jpe?g$/i.test(extname(filePath)) ? 'image/jpeg' : 'image/png';
  return { filePath, contentType };
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio
// Resolves the MP3 path for a question. Throws NOT_FOUND when the question has no audio (e.g. a
// reading question, or an unknown id). The route streams the file with range support.
export async function getAudioFile(questionId: number): Promise<AudioFileInfo> {
  const [row] = await db
    .select({ filePath: audioFiles.filePath, durationMs: audioFiles.durationMs })
    .from(audioFiles)
    .where(eq(audioFiles.questionId, questionId));
  if (!row) {
    throw new ApiError('NOT_FOUND', `No audio found for question ${questionId}.`, 404);
  }
  return row;
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/transcript
// Returns the question's phrase-level segments ordered by sequence. An unknown question id is a
// NOT_FOUND; a known question with no segments returns an empty list.
export async function getTranscript(questionId: number): Promise<TranscriptSegmentDto[]> {
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.id, questionId));
  if (!question) {
    throw new ApiError('NOT_FOUND', `Question ${questionId} not found.`, 404);
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
