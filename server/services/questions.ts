import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { audioFiles, questions, transcriptSegments } from '../db/schema';
import { ApiError } from '../lib/errors';

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
