import { extname } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import {
  sessions,
  speakingEvaluations,
  speakingResponses,
  speakingTasks,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { type Rng, pickOne } from "../lib/random";
import { scoreToNclc } from "../lib/nclc";
import { type TaskTiming, getSpeakingTiming } from "../config/exam";
import type { SpeakingFeedback } from "./speakingEvaluation";

// spec: docs/specs/speaking-session.md
// Speaking session lifecycle — PORTABLE parts only (no CLI, no `node:fs`). Create (resolve the
// per-task draw), read back for review, resolve the playback key, plus the shared loaders/types/
// helpers reused by the Node-only path (services/speaking-node.ts), which performs the Whisper
// transcription and Claude scoring (saveRecording / submit / correct / complete).
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.
// The DB is injected (server-runtime §Behaviour.5); no module singleton is imported.

export type SpeakingMode = "learning" | "real";

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

export type UploadResult = {
  transcript: string;
  audioUrl: string;
  durationMs: number | null;
};
export type SubmitResult = {
  score: number;
  level: string;
  feedback: SpeakingFeedback;
};
export type CompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  overallScore: number;
  submitted: number;
};

export type ResponseRow = typeof speakingResponses.$inferSelect;

const TASK_COUNT = 3;

// spec: docs/specs/speaking-session.md §Behaviour.3 — the per-task audio URL the UI streams from.
export function audioUrlFor(sessionId: number, taskNumber: number): string {
  return `/api/speaking/sessions/${sessionId}/responses/${taskNumber}/audio`;
}

// spec: docs/specs/speaking-session.md §Behaviour.15; server-runtime §Behaviour.6 — the portable,
// MediaStore-resolvable RELATIVE key under the speaking/ subfolder (was an absolute path pre-M14).
export function audioKeyFor(
  sessionId: number,
  taskNumber: number,
  ext: string,
): string {
  return `speaking/session-${sessionId}-task-${taskNumber}.${ext}`;
}

// Map an upload's MIME type to a file extension (browsers record webm/opus by default).
export function extensionForMime(mimetype: string | undefined): string {
  const m = (mimetype ?? "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}

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

// Shared loader exported for the Node-only path (services/speaking-node.ts).
export async function loadSession(
  db: DbClient,
  sessionId: number,
): Promise<typeof sessions.$inferSelect> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session || session.section !== "speaking") {
    throw new ApiError(
      "SESSION_NOT_FOUND",
      `Speaking session ${sessionId} not found.`,
      404,
    );
  }
  return session;
}

// Shared loader exported for the Node-only path (services/speaking-node.ts).
export async function loadResponse(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
): Promise<ResponseRow> {
  const [row] = await db
    .select()
    .from(speakingResponses)
    .where(
      and(
        eq(speakingResponses.sessionId, sessionId),
        eq(speakingResponses.taskNumber, taskNumber),
      ),
    );
  if (!row) {
    throw new ApiError(
      "NOT_FOUND",
      `No task ${taskNumber} in session ${sessionId}.`,
      404,
    );
  }
  return row;
}

// Shared loader exported for the Node-only path (services/speaking-node.ts).
export async function loadTaskForResponse(
  db: DbClient,
  row: ResponseRow,
): Promise<typeof speakingTasks.$inferSelect> {
  const [task] = await db
    .select()
    .from(speakingTasks)
    .where(eq(speakingTasks.id, row.speakingTaskId));
  if (!task) {
    throw new ApiError(
      "NOT_FOUND",
      `Task for response ${row.id} not found.`,
      404,
    );
  }
  return task;
}

// Shared loader exported for the Node-only path (services/speaking-node.ts).
export async function loadEvaluations(
  db: DbClient,
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

  const scored = tasks.filter((t) => t.score != null);
  const overallScore = tasks.length
    ? Math.round(
        tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / tasks.length,
      )
    : null;

  return {
    session: {
      id: session.id,
      mode: session.mode,
      completedAt: session.completedAt
        ? session.completedAt.toISOString()
        : null,
      elapsedMs: session.elapsedMs ?? null,
      overallScore: session.completedAt ? overallScore : null,
      submitted: scored.length,
    },
    tasks,
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

export function contentTypeForKey(key: string): string {
  const ext = extname(key).toLowerCase();
  if (ext === ".webm") return "audio/webm";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}
