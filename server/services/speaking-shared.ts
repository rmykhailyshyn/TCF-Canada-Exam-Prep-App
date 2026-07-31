import { extname } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import {
  sessions,
  speakingEvaluations,
  speakingResponses,
  speakingTasks,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import type { TaskTiming } from "../config/exam";
import type { SpeakingFeedback } from "./speakingEvaluation";

// spec: docs/specs/speaking-session.md
// Types, row loaders and media-key helpers shared by the PORTABLE speaking service (services/
// speaking.ts) and the Node-only path (services/speaking-node.ts) that performs the Whisper
// transcription and Claude scoring. Nothing here touches the CLI or `node:*`.
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.

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
  // spec: docs/specs/content-deploy.md §Behaviour.7 — null (not 0) when no task is scored, so an
  // online/practice session is never shown a fabricated /20.
  overallScore: number | null;
  submitted: number;
};

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

export type ResponseRow = typeof speakingResponses.$inferSelect;

export const TASK_COUNT = 3;

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

// The reverse of extensionForMime: the Content-Type a stored recording is streamed with.
export function contentTypeForKey(key: string): string {
  const ext = extname(key).toLowerCase();
  if (ext === ".webm") return "audio/webm";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}

// spec: docs/specs/content-deploy.md §Behaviour.7 — shared overall-score rule: null when no task is
// scored; otherwise the mean over all tasks (unscored/unrecorded count as 0, per speaking §Behaviour.17a).
export function overallFromScores(
  tasks: { score: number | null }[],
): number | null {
  const hasScore = tasks.some((t) => t.score != null);
  if (!hasScore || tasks.length === 0) return null;
  return Math.round(
    tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / tasks.length,
  );
}

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
