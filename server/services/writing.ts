import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import { sessions, writingResponses, writingTasks } from "../db/schema";
import { ApiError } from "../lib/errors";
import { type Rng, pickOne } from "../lib/random";
import { scoreToNclc } from "../lib/nclc";
import { getWritingTaskCount, getWritingTimeLimitMs } from "../config/exam";
import {
  countWords,
  loadEvaluations,
  loadResponse,
  overallFromScores,
} from "./writing-shared";
import type {
  CompleteResult,
  CreateWritingSessionInput,
  CreateWritingSessionResult,
  LockResult,
  WritingSessionDetail,
  WritingTaskDto,
  WritingTaskReview,
} from "./writing-shared";

// spec: docs/specs/writing-session.md
// Writing session lifecycle — PORTABLE parts only (no CLI). Create (resolve the per-task draw),
// autosave drafts, the practice-only lock + complete, and the read-back for review. The shared
// types/loaders live in ./writing-shared, which the Node-only scoring path (services/writing-node.ts,
// services/writing-scoring.ts) also consumes. The CLI-backed submit / correct / complete live there
// so that this module — and the portable core that imports it — never pulls in `child_process`.
// spec: docs/specs/server-runtime.md §Behaviour.8 — portable/Node split.
// The DB is injected (server-runtime §Behaviour.5); no module singleton is imported.

// The DTOs the route layer builds its request/response shapes from stay re-exported here, so the
// routes keep a single import site for the writing service.
export type {
  CompleteResult,
  CreateWritingSessionInput,
  CreateWritingSessionResult,
  LockResult,
  WritingMode,
  WritingSessionDetail,
} from "./writing-shared";
export { countWords } from "./writing-shared";

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

// The writing-session read paths 404 on anything that is not a writing session.
async function loadWritingSession(
  db: DbClient,
  sessionId: number,
): Promise<typeof sessions.$inferSelect> {
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
  return session;
}

// spec: docs/specs/writing-session.md §Behaviour.16; API contract — read-only results/review.
export async function getWritingSession(
  db: DbClient,
  sessionId: number,
): Promise<WritingSessionDetail> {
  const session = await loadWritingSession(db, sessionId);

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

  return {
    session: {
      id: session.id,
      mode: session.mode,
      completedAt: session.completedAt
        ? session.completedAt.toISOString()
        : null,
      elapsedMs: session.elapsedMs ?? null,
      // spec: docs/specs/content-deploy.md §Behaviour.7 — null (not 0) when nothing is scored, so an
      // online/practice session reads as unscored rather than 0 / 20. When at least one task is scored
      // the mean is taken over all tasks (unscored tasks count as 0), matching real-mode local scoring.
      overallScore: session.completedAt ? overallFromScores(tasks) : null,
      submitted: tasks.filter((t) => t.score != null).length,
    },
    tasks,
  };
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
  const session = await loadWritingSession(db, sessionId);

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
