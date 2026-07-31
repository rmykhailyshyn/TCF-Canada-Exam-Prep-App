import { and, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import {
  writingEvaluations,
  writingResponses,
  writingTasks,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import type { WritingFeedback } from "./writingEvaluation";

// spec: docs/specs/writing-session.md
// Types and row loaders shared by the PORTABLE writing service (services/writing.ts) and the
// Node-only scoring path (services/writing-node.ts, services/writing-scoring.ts). Nothing here
// touches the CLI, so the portable core never pulls in `child_process` through it.
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.

export type WritingMode = "learning" | "real";

export type WritingTaskDto = {
  taskId: number;
  taskNumber: number;
  title: string | null;
  prompt: string;
  instructions: string | null;
  minWords: number | null;
  maxWords: number | null;
  // Training mode only (omitted in real mode).
  sampleAnswer?: string | null;
  template?: string | null;
};

export type CreateWritingSessionInput = {
  mode: WritingMode;
  taskNumbers?: number[];
};

export type CreateWritingSessionResult = {
  sessionId: number;
  mode: WritingMode;
  tasks: WritingTaskDto[];
  timeLimitMs: number | null;
};

export type SubmitResult = {
  score: number;
  level: string;
  feedback: WritingFeedback;
};
export type CompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  // spec: docs/specs/content-deploy.md §Behaviour.7 — null (not 0) when no task is scored, so an
  // online/practice session is never shown a fabricated /20.
  overallScore: number | null;
  submitted: number;
};

// spec: docs/specs/content-deploy.md §Behaviour.4 — the online (practice-only) lock result: a draft is
// locked (submitted) with its word count, but no evaluation is produced.
export type LockResult = { wordCount: number; submitted: true };

export type WritingTaskReview = {
  taskNumber: number;
  title: string | null;
  prompt: string;
  instructions: string | null;
  minWords: number | null;
  maxWords: number | null;
  sampleAnswer: string | null;
  template: string | null;
  responseText: string;
  wordCount: number | null;
  submitted: boolean;
  score: number | null;
  level: string | null;
  feedback: WritingFeedback | null;
};

export type WritingSessionDetail = {
  session: {
    id: number;
    mode: string;
    completedAt: string | null;
    elapsedMs: number | null;
    overallScore: number | null;
    submitted: number;
  };
  tasks: WritingTaskReview[];
};

export type ResponseRow = typeof writingResponses.$inferSelect;

// spec: docs/specs/writing-ui.md §Editor.6 — words counted the same as typed input.
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// spec: docs/specs/content-deploy.md §Behaviour.7 — shared overall-score rule: null when no task is
// scored; otherwise the mean over all tasks (unscored count as 0).
export function overallFromScores(
  tasks: { score: number | null }[],
): number | null {
  const hasScore = tasks.some((t) => t.score != null);
  if (!hasScore || tasks.length === 0) return null;
  return Math.round(
    tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / tasks.length,
  );
}

export async function loadResponse(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
): Promise<ResponseRow> {
  const [row] = await db
    .select()
    .from(writingResponses)
    .where(
      and(
        eq(writingResponses.sessionId, sessionId),
        eq(writingResponses.taskNumber, taskNumber),
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
): Promise<typeof writingTasks.$inferSelect> {
  const [task] = await db
    .select()
    .from(writingTasks)
    .where(eq(writingTasks.id, row.writingTaskId));
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
): Promise<Map<number, typeof writingEvaluations.$inferSelect>> {
  if (responseIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(writingEvaluations)
    .where(inArray(writingEvaluations.responseId, responseIds));
  return new Map(rows.map((e) => [e.responseId, e]));
}
