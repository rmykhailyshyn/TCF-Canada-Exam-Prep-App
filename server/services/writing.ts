import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import {
  sessions,
  writingEvaluations,
  writingResponses,
  writingTasks,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { type Rng, pickOne } from "../lib/random";
import { scoreToNclc } from "../lib/nclc";
import { getWritingTaskCount, getWritingTimeLimitMs } from "../config/exam";
import type { WritingFeedback } from "./writingEvaluation";

// spec: docs/specs/writing-session.md
// Writing session lifecycle — PORTABLE parts only (no CLI). Create (resolve the per-task draw),
// autosave drafts, and read back for review, plus the shared loaders/types reused by the Node-only
// scoring path (services/writing-node.ts). The CLI-backed submit / correct / complete live there so
// that this module — and the portable core that imports it — never pulls in `child_process`.
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.
// The DB is injected (server-runtime §Behaviour.5); no module singleton is imported.

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

export type ResponseRow = typeof writingResponses.$inferSelect;

// spec: docs/specs/writing-ui.md §Editor.6 — words counted the same as typed input.
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// spec: docs/specs/writing-session.md §Task selection — resolve the requested task numbers.
function resolveTaskNumbers(input: CreateWritingSessionInput): number[] {
  const all = Array.from({ length: getWritingTaskCount() }, (_, i) => i + 1);
  if (input.mode === "real") return all;
  if (!input.taskNumbers || input.taskNumbers.length === 0) return all;
  const wanted = [...new Set(input.taskNumbers)];
  for (const n of wanted) {
    if (!all.includes(n)) {
      throw new ApiError(
        "BAD_REQUEST",
        `taskNumbers must be within 1–${all.length}.`,
      );
    }
  }
  return wanted.sort((a, b) => a - b);
}

// spec: docs/specs/writing-session.md §Behaviour.4–6, 12; API contract — start a writing session.
export async function createWritingSession(
  db: DbClient,
  input: CreateWritingSessionInput,
  rng: Rng = Math.random,
): Promise<CreateWritingSessionResult> {
  const taskNumbers = resolveTaskNumbers(input);

  const pool = await db
    .select()
    .from(writingTasks)
    .where(inArray(writingTasks.taskNumber, taskNumbers));

  const byNumber = new Map<number, (typeof pool)[number][]>();
  for (const t of pool) {
    const list = byNumber.get(t.taskNumber) ?? [];
    list.push(t);
    byNumber.set(t.taskNumber, list);
  }

  const resolved: (typeof pool)[number][] = [];
  for (const n of taskNumbers) {
    const candidates = byNumber.get(n);
    if (!candidates || candidates.length === 0) {
      throw new ApiError("NO_TASKS", `No writing task imported for task ${n}.`);
    }
    resolved.push(pickOne(candidates, rng));
  }

  const [created] = await db
    .insert(sessions)
    .values({ section: "writing", mode: input.mode, difficulty: null })
    .returning({ id: sessions.id });

  // Persist the draw as empty response rows so review/scoring reference the drawn task.
  await db.insert(writingResponses).values(
    resolved.map((t) => ({
      sessionId: created.id,
      writingTaskId: t.id,
      taskNumber: t.taskNumber,
      responseText: "",
    })),
  );

  const tasks: WritingTaskDto[] = resolved.map((t) => {
    const dto: WritingTaskDto = {
      taskId: t.id,
      taskNumber: t.taskNumber,
      title: t.title,
      prompt: t.prompt,
      instructions: t.instructions,
      minWords: t.minWords,
      maxWords: t.maxWords,
    };
    if (input.mode === "learning") {
      dto.sampleAnswer = t.sampleAnswer;
      dto.template = t.template;
    }
    return dto;
  });

  return {
    sessionId: created.id,
    mode: input.mode,
    tasks,
    timeLimitMs: input.mode === "real" ? getWritingTimeLimitMs() : null,
  };
}

// Shared loader exported for the Node-only scoring path (services/writing-node.ts).
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

// spec: docs/specs/writing-session.md §Behaviour.9, 13; API contract — autosave a draft.
export async function saveDraft(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<{ wordCount: number }> {
  const row = await loadResponse(db, sessionId, taskNumber);
  const wordCount = countWords(text);
  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount })
    .where(eq(writingResponses.id, row.id));
  return { wordCount };
}

// spec: docs/specs/content-deploy.md §Behaviour.4 — PORTABLE online submit: lock the draft (record
// submittedAt + wordCount) WITHOUT invoking Claude. Used by the Worker practice routes when
// capabilities.aiScoring is false; the Node entry keeps the scoring submit (services/writing-node.ts).
export async function lockResponse(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<LockResult> {
  const row = await loadResponse(db, sessionId, taskNumber);
  const wordCount = countWords(text);
  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount, submittedAt: new Date() })
    .where(eq(writingResponses.id, row.id));
  return { wordCount, submitted: true };
}

// Shared loader exported for the Node-only scoring path (services/writing-node.ts).
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

// Shared loader exported for the Node-only scoring path (services/writing-node.ts).
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

// spec: docs/specs/writing-session.md §Behaviour.16; API contract — read-only results/review.
export async function getWritingSession(
  db: DbClient,
  sessionId: number,
): Promise<WritingSessionDetail> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session || session.section !== "writing") {
    throw new ApiError(
      "SESSION_NOT_FOUND",
      `Writing session ${sessionId} not found.`,
      404,
    );
  }

  const rows = await db
    .select({
      response: writingResponses,
      task: writingTasks,
    })
    .from(writingResponses)
    .innerJoin(
      writingTasks,
      eq(writingResponses.writingTaskId, writingTasks.id),
    )
    .where(eq(writingResponses.sessionId, sessionId))
    .orderBy(asc(writingResponses.taskNumber));

  const evals = await loadEvaluations(
    db,
    rows.map((r) => r.response.id),
  );
  const isLearning = session.mode === "learning";

  const tasks: WritingTaskReview[] = rows.map(({ response, task }) => {
    const evaluation = evals.get(response.id);
    return {
      taskNumber: response.taskNumber,
      title: task.title,
      prompt: task.prompt,
      instructions: task.instructions,
      minWords: task.minWords,
      maxWords: task.maxWords,
      sampleAnswer: isLearning ? task.sampleAnswer : null,
      template: isLearning ? task.template : null,
      responseText: response.responseText,
      wordCount: response.wordCount,
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

  // spec: docs/specs/content-deploy.md §Behaviour.7 — null (not 0) when nothing is scored, so an
  // online/practice session reads as unscored rather than 0 / 20. When at least one task is scored the
  // mean is taken over all tasks (unscored tasks count as 0), matching real-mode local scoring.
  const overallScore = overallFromScores(tasks);

  return {
    session: {
      id: session.id,
      mode: session.mode,
      completedAt: session.completedAt
        ? session.completedAt.toISOString()
        : null,
      elapsedMs: session.elapsedMs ?? null,
      overallScore: session.completedAt ? overallScore : null,
      submitted: tasks.filter((t) => t.score != null).length,
    },
    tasks,
  };
}

// spec: docs/specs/content-deploy.md §Behaviour.7 — shared overall-score rule: null when no task is
// scored; otherwise the mean over all tasks (unscored count as 0).
function overallFromScores(tasks: { score: number | null }[]): number | null {
  const hasScore = tasks.some((t) => t.score != null);
  if (!hasScore || tasks.length === 0) return null;
  return Math.round(
    tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / tasks.length,
  );
}

// spec: docs/specs/content-deploy.md §Behaviour.4, 7 — PORTABLE online complete: finalise the session
// (timestamp + elapsed) and report the aggregate WITHOUT scoring. No evaluations exist online, so every
// task reads null and overallScore is null. Idempotent: a finalised session is not re-stamped. The Node
// entry keeps the scoring complete (services/writing-node.ts).
export async function completeWritingSessionUnscored(
  db: DbClient,
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session || session.section !== "writing") {
    throw new ApiError(
      "SESSION_NOT_FOUND",
      `Writing session ${sessionId} not found.`,
      404,
    );
  }

  const responses = await db
    .select()
    .from(writingResponses)
    .where(eq(writingResponses.sessionId, sessionId))
    .orderBy(asc(writingResponses.taskNumber));
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
