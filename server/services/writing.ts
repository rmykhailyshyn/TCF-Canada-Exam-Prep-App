import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { sessions, writingEvaluations, writingResponses, writingTasks } from '../db/schema';
import { ApiError } from '../lib/errors';
import { ClaudeError } from '../lib/claude-cli';
import { type Rng, pickOne } from '../lib/random';
import { scoreToNclc } from '../lib/nclc';
import { getWritingTaskCount, getWritingTimeLimitMs } from '../config/exam';
import {
  type WritingCorrection,
  type WritingFeedback,
  correctWithClaude,
  scoreWithClaude,
} from './writingEvaluation';

// spec: docs/specs/writing-session.md
// Writing session lifecycle: create (resolve the per-task draw), autosave drafts, submit (score via
// Claude), request a correction (training only), complete (aggregate), and read back for review.
// Reuses the shared `sessions` row (section='writing'; 'learning' stored, labelled "Training" in the
// UI). The resolved task per task_number is persisted as an (empty) writing_responses row at
// creation, so review/scoring always reference the task that was actually drawn.

export type WritingMode = 'learning' | 'real';

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

export type SubmitResult = { score: number; level: string; feedback: WritingFeedback };
export type CompleteResult = {
  tasks: { taskNumber: number; score: number | null; level: string | null }[];
  overallScore: number;
  submitted: number;
};

// spec: docs/specs/writing-ui.md §Editor.6 — words counted the same as typed input.
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// spec: docs/specs/writing-session.md §Task selection — resolve the requested task numbers.
function resolveTaskNumbers(input: CreateWritingSessionInput): number[] {
  const all = Array.from({ length: getWritingTaskCount() }, (_, i) => i + 1);
  if (input.mode === 'real') return all;
  if (!input.taskNumbers || input.taskNumbers.length === 0) return all;
  const wanted = [...new Set(input.taskNumbers)];
  for (const n of wanted) {
    if (!all.includes(n)) {
      throw new ApiError('BAD_REQUEST', `taskNumbers must be within 1–${all.length}.`);
    }
  }
  return wanted.sort((a, b) => a - b);
}

// spec: docs/specs/writing-session.md §Behaviour.4–6, 12; API contract — start a writing session.
export async function createWritingSession(
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
      throw new ApiError('NO_TASKS', `No writing task imported for task ${n}.`);
    }
    resolved.push(pickOne(candidates, rng));
  }

  const [created] = await db
    .insert(sessions)
    .values({ section: 'writing', mode: input.mode, difficulty: null })
    .returning({ id: sessions.id });

  // Persist the draw as empty response rows so review/scoring reference the drawn task.
  await db.insert(writingResponses).values(
    resolved.map((t) => ({
      sessionId: created.id,
      writingTaskId: t.id,
      taskNumber: t.taskNumber,
      responseText: '',
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
    if (input.mode === 'learning') {
      dto.sampleAnswer = t.sampleAnswer;
      dto.template = t.template;
    }
    return dto;
  });

  return {
    sessionId: created.id,
    mode: input.mode,
    tasks,
    timeLimitMs: input.mode === 'real' ? getWritingTimeLimitMs() : null,
  };
}

type ResponseRow = typeof writingResponses.$inferSelect;

async function loadResponse(sessionId: number, taskNumber: number): Promise<ResponseRow> {
  const [row] = await db
    .select()
    .from(writingResponses)
    .where(
      and(eq(writingResponses.sessionId, sessionId), eq(writingResponses.taskNumber, taskNumber)),
    );
  if (!row) {
    throw new ApiError('NOT_FOUND', `No task ${taskNumber} in session ${sessionId}.`, 404);
  }
  return row;
}

// spec: docs/specs/writing-session.md §Behaviour.9, 13; API contract — autosave a draft.
export async function saveDraft(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<{ wordCount: number }> {
  const row = await loadResponse(sessionId, taskNumber);
  const wordCount = countWords(text);
  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount })
    .where(eq(writingResponses.id, row.id));
  return { wordCount };
}

async function loadTaskForResponse(row: ResponseRow): Promise<typeof writingTasks.$inferSelect> {
  const [task] = await db.select().from(writingTasks).where(eq(writingTasks.id, row.writingTaskId));
  if (!task) {
    throw new ApiError('NOT_FOUND', `Task for response ${row.id} not found.`, 404);
  }
  return task;
}

async function persistEvaluation(
  responseId: number,
  score: number,
  feedback: WritingFeedback,
): Promise<void> {
  const generatedBy = process.env.CLAUDE_CLI_MODEL
    ? `claude-cli/${process.env.CLAUDE_CLI_MODEL}`
    : 'claude-cli';
  await db.transaction(async (tx) => {
    await tx.delete(writingEvaluations).where(eq(writingEvaluations.responseId, responseId));
    await tx.insert(writingEvaluations).values({
      responseId,
      score,
      strengths: feedback.strengths,
      errors: feedback.errors,
      improvements: feedback.improvements,
      generatedBy,
    });
  });
}

// spec: docs/specs/writing-session.md §Behaviour.10, 15; writing-evaluation §Behaviour.3–8 — submit.
export async function submitResponse(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<SubmitResult> {
  const row = await loadResponse(sessionId, taskNumber);
  const task = await loadTaskForResponse(row);

  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount: countWords(text), submittedAt: new Date() })
    .where(eq(writingResponses.id, row.id));

  let score: number;
  let feedback: WritingFeedback;
  try {
    const result = scoreWithClaude({
      taskNumber: task.taskNumber,
      prompt: task.prompt,
      minWords: task.minWords,
      maxWords: task.maxWords,
      responseText: text,
    });
    score = result.score;
    feedback = result.feedback;
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError('EVALUATION_FAILED', `Could not score the response: ${error.message}`, 502);
    }
    throw error;
  }

  await persistEvaluation(row.id, score, feedback);
  return { score, level: scoreToNclc(score), feedback };
}

// spec: docs/specs/writing-session.md §Behaviour.10; writing-evaluation §Behaviour.7 — correction
// (training only). The session's mode is checked here; the service itself is mode-agnostic.
export async function requestCorrection(
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<WritingCorrection> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.section !== 'writing') {
    throw new ApiError('SESSION_NOT_FOUND', `Writing session ${sessionId} not found.`, 404);
  }
  if (session.mode !== 'learning') {
    throw new ApiError('MODE_NOT_ALLOWED', 'Corrections are only available in training mode.');
  }

  const row = await loadResponse(sessionId, taskNumber);
  const task = await loadTaskForResponse(row);

  // Persist the latest draft so the correction reflects what the user sees.
  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount: countWords(text) })
    .where(eq(writingResponses.id, row.id));

  try {
    return correctWithClaude({ prompt: task.prompt, responseText: text });
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError('CORRECTION_FAILED', `Could not produce a correction: ${error.message}`, 502);
    }
    throw error;
  }
}

// spec: docs/specs/writing-session.md §Behaviour.14, 15; API contract — finalise + aggregate.
export async function completeWritingSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.section !== 'writing') {
    throw new ApiError('SESSION_NOT_FOUND', `Writing session ${sessionId} not found.`, 404);
  }

  const responses = await db
    .select()
    .from(writingResponses)
    .where(eq(writingResponses.sessionId, sessionId))
    .orderBy(asc(writingResponses.taskNumber));

  let evals = await loadEvaluations(responses.map((r) => r.id));

  // spec: docs/specs/writing-session.md §Behaviour.14 — real mode submits/evaluates any draft still
  // unscored (best-effort: a CLI failure leaves that task unscored rather than blocking completion).
  if (session.mode === 'real') {
    for (const row of responses) {
      if (evals.has(row.id)) continue;
      const task = await loadTaskForResponse(row);
      try {
        const result = scoreWithClaude({
          taskNumber: task.taskNumber,
          prompt: task.prompt,
          minWords: task.minWords,
          maxWords: task.maxWords,
          responseText: row.responseText,
        });
        await db
          .update(writingResponses)
          .set({ submittedAt: row.submittedAt ?? new Date() })
          .where(eq(writingResponses.id, row.id));
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
  const overallScore = responses.length
    ? Math.round(tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / responses.length)
    : 0;

  return { tasks, overallScore, submitted };
}

async function loadEvaluations(
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
export async function getWritingSession(sessionId: number): Promise<WritingSessionDetail> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.section !== 'writing') {
    throw new ApiError('SESSION_NOT_FOUND', `Writing session ${sessionId} not found.`, 404);
  }

  const rows = await db
    .select({
      response: writingResponses,
      task: writingTasks,
    })
    .from(writingResponses)
    .innerJoin(writingTasks, eq(writingResponses.writingTaskId, writingTasks.id))
    .where(eq(writingResponses.sessionId, sessionId))
    .orderBy(asc(writingResponses.taskNumber));

  const evals = await loadEvaluations(rows.map((r) => r.response.id));
  const isLearning = session.mode === 'learning';

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
