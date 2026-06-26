import { asc, eq } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import { sessions, writingEvaluations, writingResponses } from "../db/schema";
import { ApiError } from "../lib/errors";
import { ClaudeError } from "../lib/claude-cli";
import { scoreToNclc } from "../lib/nclc";
import {
  type CompleteResult,
  type SubmitResult,
  countWords,
  loadEvaluations,
  loadResponse,
  loadTaskForResponse,
} from "./writing";
import {
  type WritingCorrection,
  type WritingFeedback,
  correctWithClaude,
  scoreWithClaude,
} from "./writingEvaluation";

// spec: docs/specs/writing-session.md; docs/specs/server-runtime.md §Behaviour.8
// Node-only writing scoring path: submit, request a correction (training only), and complete all
// invoke the LOCAL Claude CLI (via ./writingEvaluation → ../lib/claude-cli → child_process), so they
// cannot run in the Worker bundle. They are registered only by the Node entry (routes/node-routes.ts)
// and reuse the portable loaders from ./writing. The DB is injected (server-runtime §Behaviour.5).

async function persistEvaluation(
  db: DbClient,
  responseId: number,
  score: number,
  feedback: WritingFeedback,
): Promise<void> {
  const generatedBy = process.env.CLAUDE_CLI_MODEL
    ? `claude-cli/${process.env.CLAUDE_CLI_MODEL}`
    : "claude-cli";
  await db.transaction(async (tx) => {
    await tx
      .delete(writingEvaluations)
      .where(eq(writingEvaluations.responseId, responseId));
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
  db: DbClient,
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<SubmitResult> {
  const row = await loadResponse(db, sessionId, taskNumber);
  const task = await loadTaskForResponse(db, row);

  await db
    .update(writingResponses)
    .set({
      responseText: text,
      wordCount: countWords(text),
      submittedAt: new Date(),
    })
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
      throw new ApiError(
        "EVALUATION_FAILED",
        `Could not score the response: ${error.message}`,
        502,
      );
    }
    throw error;
  }

  await persistEvaluation(db, row.id, score, feedback);
  return { score, level: scoreToNclc(score), feedback };
}

// spec: docs/specs/writing-session.md §Behaviour.10; writing-evaluation §Behaviour.7 — correction
// (training only). The session's mode is checked here; the service itself is mode-agnostic.
export async function requestCorrection(
  db: DbClient,
  sessionId: number,
  taskNumber: number,
  text: string,
): Promise<WritingCorrection> {
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
  if (session.mode !== "learning") {
    throw new ApiError(
      "MODE_NOT_ALLOWED",
      "Corrections are only available in training mode.",
    );
  }

  const row = await loadResponse(db, sessionId, taskNumber);
  const task = await loadTaskForResponse(db, row);

  // Persist the latest draft so the correction reflects what the user sees.
  await db
    .update(writingResponses)
    .set({ responseText: text, wordCount: countWords(text) })
    .where(eq(writingResponses.id, row.id));

  try {
    return correctWithClaude({ prompt: task.prompt, responseText: text });
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError(
        "CORRECTION_FAILED",
        `Could not produce a correction: ${error.message}`,
        502,
      );
    }
    throw error;
  }
}

// spec: docs/specs/writing-session.md §Behaviour.14, 15; API contract — finalise + aggregate.
export async function completeWritingSession(
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

  let evals = await loadEvaluations(
    db,
    responses.map((r) => r.id),
  );

  // spec: docs/specs/writing-session.md §Behaviour.14 — real mode submits/evaluates any draft still
  // unscored (best-effort: a CLI failure leaves that task unscored rather than blocking completion).
  if (session.mode === "real") {
    for (const row of responses) {
      if (evals.has(row.id)) continue;
      const task = await loadTaskForResponse(db, row);
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
        await persistEvaluation(db, row.id, result.score, result.feedback);
      } catch (error) {
        if (!(error instanceof ClaudeError)) throw error;
        // leave unscored
      }
    }
    evals = await loadEvaluations(
      db,
      responses.map((r) => r.id),
    );
  }

  await db
    .update(sessions)
    .set({
      completedAt: new Date(),
      elapsedMs: session.mode === "real" ? elapsedMs : null,
    })
    .where(eq(sessions.id, sessionId));

  const tasks = responses.map((r) => {
    const score = evals.get(r.id)?.score ?? null;
    return {
      taskNumber: r.taskNumber,
      score,
      level: score == null ? null : scoreToNclc(score),
    };
  });
  const submitted = tasks.filter((t) => t.score != null).length;
  const overallScore = responses.length
    ? Math.round(
        tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / responses.length,
      )
    : 0;

  return { tasks, overallScore, submitted };
}
