import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { sessions, speakingEvaluations, speakingResponses, speakingTasks } from '../db/schema';
import { ApiError } from '../lib/errors';
import { ClaudeError } from '../lib/claude-cli';
import { type Rng, pickOne } from '../lib/random';
import { scoreToNclc } from '../lib/nclc';
import { getMediaDir } from '../config/env';
import { type TaskTiming, getSpeakingTiming } from '../config/exam';
import {
  type SpeakingCorrection,
  type SpeakingFeedback,
  correctWithClaude,
  scoreWithClaude,
} from './speakingEvaluation';
import { WhisperError, transcribeFile } from './speakingTranscription';

// spec: docs/specs/speaking-session.md
// Speaking session lifecycle: create (resolve the per-task draw), upload a recording (save audio +
// transcribe), submit (score via Claude), request a correction (training only), complete (aggregate),
// and read back for review. Reuses the shared `sessions` row (section='speaking'; 'learning' stored,
// labelled "Training" in the UI). The resolved task per task_number is persisted as an (empty)
// speaking_responses row at creation, so review/scoring always reference the task that was drawn.

export type SpeakingMode = 'learning' | 'real';

export type SpeakingTaskDto = {
  taskId: number;
  taskNumber: number;
  question: string;
  // Training mode only (omitted in real mode).
  sampleAnswer?: string | null;
};

export type CreateSpeakingSessionInput = {
  mode: SpeakingMode;
  taskNumbers?: number[];
};

export type CreateSpeakingSessionResult = {
  sessionId: number;
  mode: SpeakingMode;
  tasks: SpeakingTaskDto[];
  timing: TaskTiming[] | null;
};

export type UploadResult = { transcript: string; audioUrl: string; durationMs: number | null };
export type SubmitResult = { score: number; level: string; feedback: SpeakingFeedback };
export type CompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  overallScore: number;
  submitted: number;
};

const TASK_COUNT = 3;

// spec: docs/specs/speaking-session.md §Behaviour.3 — the per-task audio URL the UI streams from.
function audioUrlFor(sessionId: number, taskNumber: number): string {
  return `/api/speaking/sessions/${sessionId}/responses/${taskNumber}/audio`;
}

// spec: docs/specs/speaking-session.md §Behaviour.15 — recordings are saved under MEDIA_DIR.
function audioPathFor(sessionId: number, taskNumber: number, ext: string): string {
  return resolve(join(getMediaDir(), 'speaking', `session-${sessionId}-task-${taskNumber}.${ext}`));
}

// Map an upload's MIME type to a file extension (browsers record webm/opus by default).
function extensionForMime(mimetype: string | undefined): string {
  const m = (mimetype ?? '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

// spec: docs/specs/speaking-session.md §Behaviour.4–6 — resolve the requested task numbers.
function resolveTaskNumbers(input: CreateSpeakingSessionInput): number[] {
  const all = Array.from({ length: TASK_COUNT }, (_, i) => i + 1);
  if (input.mode === 'real') return all;
  if (!input.taskNumbers || input.taskNumbers.length === 0) return all;
  const wanted = [...new Set(input.taskNumbers)];
  for (const n of wanted) {
    if (!all.includes(n)) {
      throw new ApiError('BAD_REQUEST', `taskNumbers must be within 1–${TASK_COUNT}.`);
    }
  }
  return wanted.sort((a, b) => a - b);
}

// spec: docs/specs/speaking-session.md §Behaviour.4–6, 12; API contract — start a speaking session.
export async function createSpeakingSession(
  input: CreateSpeakingSessionInput,
  rng: Rng = Math.random,
): Promise<CreateSpeakingSessionResult> {
  const taskNumbers = resolveTaskNumbers(input);

  const pool = await db
    .select()
    .from(speakingTasks)
    .where(inArray(speakingTasks.taskNumber, taskNumbers));

  const byNumber = new Map<number, (typeof pool)[number][]>();
  for (const t of pool) {
    const list = byNumber.get(t.taskNumber) ?? [];
    list.push(t);
    byNumber.set(t.taskNumber, list);
  }

  // spec: docs/specs/speaking-session.md §Behaviour.6 — draw one candidate per task_number.
  const resolved: (typeof pool)[number][] = [];
  for (const n of taskNumbers) {
    const candidates = byNumber.get(n);
    if (!candidates || candidates.length === 0) {
      throw new ApiError('NO_TASKS', `No speaking task imported for task ${n}.`);
    }
    resolved.push(pickOne(candidates, rng));
  }

  const [created] = await db
    .insert(sessions)
    .values({ section: 'speaking', mode: input.mode, difficulty: null })
    .returning({ id: sessions.id });

  // Persist the draw as empty response rows so review/scoring reference the drawn task.
  await db.insert(speakingResponses).values(
    resolved.map((t) => ({
      sessionId: created.id,
      speakingTaskId: t.id,
      taskNumber: t.taskNumber,
    })),
  );

  const tasks: SpeakingTaskDto[] = resolved.map((t) => {
    const dto: SpeakingTaskDto = { taskId: t.id, taskNumber: t.taskNumber, question: t.question };
    if (input.mode === 'learning') dto.sampleAnswer = t.sampleAnswer;
    return dto;
  });

  return {
    sessionId: created.id,
    mode: input.mode,
    tasks,
    // spec: docs/specs/speaking-session.md §Behaviour.18 — real-mode timing from exam.config.json.
    timing: input.mode === 'real' ? getSpeakingTiming() : null,
  };
}

type ResponseRow = typeof speakingResponses.$inferSelect;

async function loadSession(sessionId: number): Promise<typeof sessions.$inferSelect> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.section !== 'speaking') {
    throw new ApiError('SESSION_NOT_FOUND', `Speaking session ${sessionId} not found.`, 404);
  }
  return session;
}

async function loadResponse(sessionId: number, taskNumber: number): Promise<ResponseRow> {
  const [row] = await db
    .select()
    .from(speakingResponses)
    .where(
      and(eq(speakingResponses.sessionId, sessionId), eq(speakingResponses.taskNumber, taskNumber)),
    );
  if (!row) {
    throw new ApiError('NOT_FOUND', `No task ${taskNumber} in session ${sessionId}.`, 404);
  }
  return row;
}

async function loadTaskForResponse(row: ResponseRow): Promise<typeof speakingTasks.$inferSelect> {
  const [task] = await db.select().from(speakingTasks).where(eq(speakingTasks.id, row.speakingTaskId));
  if (!task) {
    throw new ApiError('NOT_FOUND', `Task for response ${row.id} not found.`, 404);
  }
  return task;
}

// spec: docs/specs/speaking-session.md §Behaviour.15; speaking-evaluation §Behaviour.3–5 — save a
// recording under MEDIA_DIR, transcribe it (Whisper), and store the draft (no scoring yet).
export async function saveRecording(
  sessionId: number,
  taskNumber: number,
  audio: Buffer,
  mimetype: string | undefined,
): Promise<UploadResult> {
  await loadSession(sessionId);
  const row = await loadResponse(sessionId, taskNumber);

  const ext = extensionForMime(mimetype);
  const filePath = audioPathFor(sessionId, taskNumber, ext);
  mkdirSync(join(getMediaDir(), 'speaking'), { recursive: true });
  // Re-recording replaces the prior take; drop a stale file if its extension changed.
  if (row.audioPath && row.audioPath !== filePath && existsSync(row.audioPath)) {
    rmSync(row.audioPath, { force: true });
  }
  writeFileSync(filePath, audio);

  let transcript: string;
  let durationMs: number | null;
  try {
    const result = transcribeFile(filePath);
    transcript = result.transcript;
    durationMs = result.durationMs;
  } catch (error) {
    if (error instanceof WhisperError) {
      // spec: speaking-evaluation §Behaviour.5 — keep the audio (stored below) for a retry.
      await db
        .update(speakingResponses)
        .set({ audioPath: filePath })
        .where(eq(speakingResponses.id, row.id));
      throw new ApiError('TRANSCRIPTION_FAILED', `Could not transcribe the recording: ${error.message}`, 502);
    }
    throw error;
  }

  // A new recording invalidates any prior transcript-driven state; clear submittedAt so the user
  // re-submits the new take (re-recording replaces prior audio + transcript — Behaviour.15).
  await db
    .update(speakingResponses)
    .set({ audioPath: filePath, transcript, durationMs, submittedAt: null })
    .where(eq(speakingResponses.id, row.id));

  return { transcript, audioUrl: audioUrlFor(sessionId, taskNumber), durationMs };
}

const generatedBy = (): string =>
  process.env.CLAUDE_CLI_MODEL ? `claude-cli/${process.env.CLAUDE_CLI_MODEL}` : 'claude-cli';

async function persistEvaluation(
  responseId: number,
  score: number,
  feedback: SpeakingFeedback,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(speakingEvaluations).where(eq(speakingEvaluations.responseId, responseId));
    await tx.insert(speakingEvaluations).values({
      responseId,
      score,
      strengths: feedback.strengths,
      errors: feedback.errors,
      improvements: feedback.improvements,
      generatedBy: generatedBy(),
    });
  });
}

// spec: docs/specs/speaking-session.md §Behaviour.10, 16; speaking-evaluation §Behaviour.6–8 — submit.
export async function submitResponse(
  sessionId: number,
  taskNumber: number,
): Promise<SubmitResult> {
  await loadSession(sessionId);
  const row = await loadResponse(sessionId, taskNumber);
  if (!row.transcript || row.transcript.trim().length === 0) {
    throw new ApiError('NO_RECORDING', `No recording to submit for task ${taskNumber}.`);
  }
  const task = await loadTaskForResponse(row);

  let score: number;
  let feedback: SpeakingFeedback;
  try {
    const result = scoreWithClaude({
      taskNumber: task.taskNumber,
      question: task.question,
      transcript: row.transcript,
    });
    score = result.score;
    feedback = result.feedback;
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError('EVALUATION_FAILED', `Could not score the response: ${error.message}`, 502);
    }
    throw error;
  }

  await db
    .update(speakingResponses)
    .set({ submittedAt: new Date() })
    .where(eq(speakingResponses.id, row.id));
  await persistEvaluation(row.id, score, feedback);
  return { score, level: scoreToNclc(score), feedback };
}

// spec: docs/specs/speaking-session.md §Behaviour.10; speaking-evaluation §Behaviour.9 — correction
// (training only). The session's mode is checked here; the service itself is mode-agnostic.
export async function requestCorrection(
  sessionId: number,
  taskNumber: number,
): Promise<SpeakingCorrection> {
  const session = await loadSession(sessionId);
  if (session.mode !== 'learning') {
    throw new ApiError('MODE_NOT_ALLOWED', 'Corrections are only available in training mode.');
  }

  const row = await loadResponse(sessionId, taskNumber);
  if (!row.transcript || row.transcript.trim().length === 0) {
    throw new ApiError('NO_RECORDING', `No recording to correct for task ${taskNumber}.`);
  }
  const task = await loadTaskForResponse(row);

  try {
    return correctWithClaude({ question: task.question, transcript: row.transcript });
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError('CORRECTION_FAILED', `Could not produce a correction: ${error.message}`, 502);
    }
    throw error;
  }
}

// spec: docs/specs/speaking-session.md §Behaviour.14, 16, 17a; API contract — finalise + aggregate.
export async function completeSpeakingSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  const session = await loadSession(sessionId);

  const responses = await db
    .select()
    .from(speakingResponses)
    .where(eq(speakingResponses.sessionId, sessionId))
    .orderBy(asc(speakingResponses.taskNumber));

  let evals = await loadEvaluations(responses.map((r) => r.id));

  // spec: docs/specs/speaking-session.md §Behaviour.14 — real mode submits/evaluates any recorded
  // task still unscored (best-effort: a CLI failure leaves that task unscored rather than blocking).
  if (session.mode === 'real') {
    for (const row of responses) {
      if (evals.has(row.id)) continue;
      if (!row.transcript || row.transcript.trim().length === 0) continue;
      const task = await loadTaskForResponse(row);
      try {
        const result = scoreWithClaude({
          taskNumber: task.taskNumber,
          question: task.question,
          transcript: row.transcript,
        });
        await db
          .update(speakingResponses)
          .set({ submittedAt: row.submittedAt ?? new Date() })
          .where(eq(speakingResponses.id, row.id));
        await persistEvaluation(row.id, result.score, result.feedback);
      } catch (error) {
        if (!(error instanceof ClaudeError)) throw error;
        // leave unscored
      }
    }
    evals = await loadEvaluations(responses.map((r) => r.id));
  }

  await db
    .update(sessions)
    .set({ completedAt: new Date(), elapsedMs: session.mode === 'real' ? elapsedMs : null })
    .where(eq(sessions.id, sessionId));

  const tasks = responses.map((r) => {
    const score = evals.get(r.id)?.score ?? null;
    return { taskNumber: r.taskNumber, score, level: score == null ? null : scoreToNclc(score) };
  });
  const submitted = tasks.filter((t) => t.score != null).length;
  // spec: docs/specs/speaking-session.md §Behaviour.17a — un-recorded/unscored tasks count as 0.
  const overallScore = responses.length
    ? Math.round(tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / responses.length)
    : 0;

  return { tasks, overallScore, submitted };
}

async function loadEvaluations(
  responseIds: number[],
): Promise<Map<number, typeof speakingEvaluations.$inferSelect>> {
  if (responseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(speakingEvaluations)
    .where(inArray(speakingEvaluations.responseId, responseIds));
  return new Map(rows.map((e) => [e.responseId, e]));
}

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

// spec: docs/specs/speaking-session.md §Behaviour.16, 17a; API contract — read-only results/review.
export async function getSpeakingSession(sessionId: number): Promise<SpeakingSessionDetail> {
  const session = await loadSession(sessionId);

  const rows = await db
    .select({ response: speakingResponses, task: speakingTasks })
    .from(speakingResponses)
    .innerJoin(speakingTasks, eq(speakingResponses.speakingTaskId, speakingTasks.id))
    .where(eq(speakingResponses.sessionId, sessionId))
    .orderBy(asc(speakingResponses.taskNumber));

  const evals = await loadEvaluations(rows.map((r) => r.response.id));
  const isLearning = session.mode === 'learning';

  const tasks: SpeakingTaskReview[] = rows.map(({ response, task }) => {
    const evaluation = evals.get(response.id);
    const hasAudio = response.audioPath != null;
    return {
      taskNumber: response.taskNumber,
      question: task.question,
      sampleAnswer: isLearning ? task.sampleAnswer : null,
      transcript: response.transcript,
      durationMs: response.durationMs,
      hasAudio,
      audioUrl: hasAudio ? audioUrlFor(sessionId, response.taskNumber) : null,
      submitted: response.submittedAt != null,
      score: evaluation?.score ?? null,
      level: evaluation ? scoreToNclc(evaluation.score) : null,
      feedback: evaluation
        ? {
            strengths: evaluation.strengths,
            errors: evaluation.errors,
            improvements: evaluation.improvements,
          }
        : null,
    };
  });

  const scored = tasks.filter((t) => t.score != null);
  const overallScore = tasks.length
    ? Math.round(tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / tasks.length)
    : null;

  return {
    session: {
      id: session.id,
      mode: session.mode,
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
      elapsedMs: session.elapsedMs ?? null,
      overallScore: session.completedAt ? overallScore : null,
      submitted: scored.length,
    },
    tasks,
  };
}

// spec: docs/specs/speaking-session.md §API contract GET …/audio — resolve the saved file to stream.
export async function getResponseAudioPath(
  sessionId: number,
  taskNumber: number,
): Promise<{ filePath: string; contentType: string }> {
  await loadSession(sessionId);
  const row = await loadResponse(sessionId, taskNumber);
  if (!row.audioPath) {
    throw new ApiError('NOT_FOUND', `No recording for task ${taskNumber} in session ${sessionId}.`, 404);
  }
  return { filePath: row.audioPath, contentType: contentTypeForPath(row.audioPath) };
}

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}
