import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import { sessions, speakingResponses, speakingTasks } from "../db/schema";
import { ApiError } from "../lib/errors";
import { type Rng, pickOne } from "../lib/random";
import { scoreToNclc } from "../lib/nclc";
import { getSpeakingTiming } from "../config/exam";
import type { MediaStore } from "../runtime/media-store";
import {
  TASK_COUNT,
  audioKeyFor,
  audioUrlFor,
  contentTypeForKey,
  extensionForMime,
  loadEvaluations,
  loadResponse,
  loadSession,
  overallFromScores,
} from "./speaking-shared";
import type {
  CompleteResult,
  CreateSpeakingSessionInput,
  CreateSpeakingSessionResult,
  SpeakingSessionDetail,
  SpeakingTaskDto,
  SpeakingTaskReview,
  UploadResult,
} from "./speaking-shared";

// spec: docs/specs/speaking-session.md
// Speaking session lifecycle — PORTABLE parts only (no CLI, no `node:fs`). Create (resolve the
// per-task draw), read back for review, resolve the playback key, plus the practice-only (online)
// store + complete. The shared types/loaders/media helpers live in ./speaking-shared, which the
// Node-only path (services/speaking-node.ts) also consumes for the Whisper transcription and Claude
// scoring (saveRecording / submit / correct / complete).
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.
// The DB is injected (server-runtime §Behaviour.5); no module singleton is imported.

// The DTOs the route layer builds its request/response shapes from stay re-exported here, so the
// routes keep a single import site for the speaking service.
export type {
  CompleteResult,
  CreateSpeakingSessionInput,
  CreateSpeakingSessionResult,
  SpeakingMode,
  SpeakingSessionDetail,
  UploadResult,
} from "./speaking-shared";

// spec: docs/specs/speaking-session.md §Behaviour.4–6 — resolve the requested task numbers.
function resolveTaskNumbers(input: CreateSpeakingSessionInput): number[] {
  const all = Array.from({ length: TASK_COUNT }, (_, i) => i + 1);
  if (input.mode === "real") return all;
  if (!input.taskNumbers || input.taskNumbers.length === 0) return all;
  const wanted = [...new Set(input.taskNumbers)];
  for (const n of wanted) {
    if (!all.includes(n)) {
      throw new ApiError(
        "BAD_REQUEST",
        `taskNumbers must be within 1–${TASK_COUNT}.`,
      );
    }
  }
  return wanted.sort((a, b) => a - b);
}

// spec: docs/specs/speaking-session.md §Behaviour.4–6, 12; API contract — start a speaking session.
export async function createSpeakingSession(
  db: DbClient,
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
      throw new ApiError(
        "NO_TASKS",
        `No speaking task imported for task ${n}.`,
      );
    }
    resolved.push(pickOne(candidates, rng));
  }

  const [created] = await db
    .insert(sessions)
    .values({ section: "speaking", mode: input.mode, difficulty: null })
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
    const dto: SpeakingTaskDto = {
      taskId: t.id,
      taskNumber: t.taskNumber,
      question: t.question,
    };
    if (input.mode === "learning") dto.sampleAnswer = t.sampleAnswer;
    return dto;
  });

  return {
    sessionId: created.id,
    mode: input.mode,
    tasks,
    // spec: docs/specs/speaking-session.md §Behaviour.18 — real-mode timing from exam.config.json.
    timing: input.mode === "real" ? getSpeakingTiming() : null,
  };
}

// spec: docs/specs/speaking-session.md §Behaviour.16, 17a; API contract — read-only results/review.
export async function getSpeakingSession(
  db: DbClient,
  sessionId: number,
): Promise<SpeakingSessionDetail> {
  const session = await loadSession(db, sessionId);

  const rows = await db
    .select({ response: speakingResponses, task: speakingTasks })
    .from(speakingResponses)
    .innerJoin(
      speakingTasks,
      eq(speakingResponses.speakingTaskId, speakingTasks.id),
    )
    .where(eq(speakingResponses.sessionId, sessionId))
    .orderBy(asc(speakingResponses.taskNumber));

  const evals = await loadEvaluations(
    db,
    rows.map((r) => r.response.id),
  );
  const isLearning = session.mode === "learning";

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

  return {
    session: {
      id: session.id,
      mode: session.mode,
      completedAt: session.completedAt
        ? session.completedAt.toISOString()
        : null,
      elapsedMs: session.elapsedMs ?? null,
      // spec: docs/specs/content-deploy.md §Behaviour.7 — null (not 0) when nothing is scored, so an
      // online/practice session reads as unscored. With at least one score the mean is over all tasks.
      overallScore: session.completedAt ? overallFromScores(tasks) : null,
      submitted: tasks.filter((t) => t.score != null).length,
    },
    tasks,
  };
}

// spec: docs/specs/content-deploy.md §Behaviour.5 — PORTABLE online recording upload: store the audio
// bytes through the MediaStore (R2 on the Worker) WITHOUT Whisper. No transcript/duration is produced;
// the recording is kept only for in-session playback. The Node entry keeps the transcribing upload
// (services/speaking-node.ts → saveRecording).
export async function storeRecording(
  db: DbClient,
  mediaStore: MediaStore,
  sessionId: number,
  taskNumber: number,
  audio: Uint8Array,
  mimetype: string | undefined,
): Promise<UploadResult> {
  await loadSession(db, sessionId);
  const row = await loadResponse(db, sessionId, taskNumber);

  const ext = extensionForMime(mimetype);
  const key = audioKeyFor(sessionId, taskNumber, ext);
  // Re-recording replaces the prior take; drop a stale stored object if its key changed.
  if (row.audioPath && row.audioPath !== key) {
    await mediaStore.delete(row.audioPath);
  }
  await mediaStore.put(key, audio, `audio/${ext}`);

  // No transcription online: clear any prior transcript/duration and the submitted flag.
  await db
    .update(speakingResponses)
    .set({
      audioPath: key,
      transcript: null,
      durationMs: null,
      submittedAt: null,
    })
    .where(eq(speakingResponses.id, row.id));

  return {
    transcript: "",
    audioUrl: audioUrlFor(sessionId, taskNumber),
    durationMs: null,
  };
}

// spec: docs/specs/content-deploy.md §Behaviour.4, 7 — PORTABLE online complete: finalise the session
// (timestamp + elapsed) and report the aggregate WITHOUT scoring. No evaluations exist online, so every
// task reads null and overallScore is null. Idempotent: a finalised session is not re-stamped.
export async function completeSpeakingSessionUnscored(
  db: DbClient,
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  const session = await loadSession(db, sessionId);

  const responses = await db
    .select()
    .from(speakingResponses)
    .where(eq(speakingResponses.sessionId, sessionId))
    .orderBy(asc(speakingResponses.taskNumber));
  const evals = await loadEvaluations(
    db,
    responses.map((r) => r.id),
  );

  if (!session.completedAt) {
    await db
      .update(sessions)
      .set({
        completedAt: new Date(),
        elapsedMs: session.mode === "real" ? elapsedMs : null,
      })
      .where(eq(sessions.id, sessionId));
  }

  const tasks = responses.map((r) => {
    const score = evals.get(r.id)?.score ?? null;
    return {
      taskNumber: r.taskNumber,
      score,
      level: score == null ? null : scoreToNclc(score),
    };
  });
  return {
    tasks,
    overallScore: overallFromScores(tasks),
    submitted: tasks.filter((t) => t.score != null).length,
  };
}

// spec: docs/specs/speaking-session.md §API contract GET …/audio — resolve the stored key to stream.
// Returns the MediaStore-resolvable key (relative or legacy absolute) + its content type; the route
// streams the bytes through the MediaStore. spec: docs/specs/server-runtime.md §Behaviour.6
export async function getResponseAudioKey(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
): Promise<{ key: string; contentType: string }> {
  await loadSession(db, sessionId);
  const row = await loadResponse(db, sessionId, taskNumber);
  if (!row.audioPath) {
    throw new ApiError(
      "NOT_FOUND",
      `No recording for task ${taskNumber} in session ${sessionId}.`,
      404,
    );
  }
  return { key: row.audioPath, contentType: contentTypeForKey(row.audioPath) };
}
