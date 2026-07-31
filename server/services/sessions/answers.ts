import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/factory";
import {
  explanations,
  options,
  questionResults,
  questions,
  sessions,
} from "../../db/schema";
import { ApiError } from "../../lib/errors";
import {
  bandForSlug,
  pointsForSequence,
  sequenceInBand,
} from "../../lib/bands";
import type { Section } from "../../config/exam";
import { loadSession, toExplanation } from "./shared";
import type {
  CompleteSessionResult,
  OptionLabel,
  RecordAnswerResult,
} from "./types";

// spec: docs/specs/quiz-session.md §API contract
// Recording an answer and finalising a session — the write half of the session lifecycle.

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
export async function recordAnswer(
  db: DbClient,
  sessionId: number,
  questionId: number,
  chosenLabel: OptionLabel,
): Promise<RecordAnswerResult> {
  const session = await loadSession(db, sessionId);

  const qOptions = await db
    .select()
    .from(options)
    .where(eq(options.questionId, questionId));
  const correct = qOptions.find((o) => o.isCorrect);
  if (!correct) {
    throw new ApiError(
      "ANSWER_KEY_MISSING",
      `Question ${questionId} has no answer key.`,
    );
  }

  const isCorrect = chosenLabel === correct.label;
  await db
    .insert(questionResults)
    .values({ sessionId, questionId, chosenLabel, isCorrect });

  // Real mode returns no correctness feedback (Behaviour.9).
  if (session.mode === "real") {
    return { mode: "real" };
  }

  // Learning mode reveals the correct option and bundles the explanation in one JOIN.
  const [exp] = await db
    .select()
    .from(explanations)
    .where(eq(explanations.questionId, questionId));

  return {
    mode: "learning",
    isCorrect,
    correctLabel: correct.label as OptionLabel,
    explanation: toExplanation(exp),
  };
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
export async function completeSession(
  db: DbClient,
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteSessionResult> {
  const session = await loadSession(db, sessionId);

  await db
    .update(sessions)
    .set({
      completedAt: new Date(),
      elapsedMs: session.mode === "real" ? elapsedMs : null,
    })
    .where(eq(sessions.id, sessionId));

  // Correctness comes from the recorded answers joined to question sequences.
  const results = await db
    .select({
      isCorrect: questionResults.isCorrect,
      sequence: questions.sequence,
    })
    .from(questionResults)
    .innerJoin(questions, eq(questionResults.questionId, questions.id))
    .where(eq(questionResults.sessionId, sessionId));

  const correct = results.filter((r) => r.isCorrect).length;

  // `total` reflects the resolved set size (quiz-session §Results.13). Learning mode practises
  // every band question (so the band's question count), while real mode is a one-question-per-
  // position exam (so the number of DISTINCT occupied positions — multiple imports at the same
  // position must never inflate the total or the points possible).
  const sectionRows = await db
    .select({ sequence: questions.sequence })
    .from(questions)
    .where(eq(questions.section, session.section as Section));

  let total: number;
  let pointsScored: number | null = null;
  let pointsPossible: number | null = null;
  if (session.mode === "real") {
    const positions = [...new Set(sectionRows.map((q) => q.sequence))];
    total = positions.length;
    pointsScored = results
      .filter((r) => r.isCorrect)
      .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
    pointsPossible = positions.reduce(
      (sum, pos) => sum + pointsForSequence(pos),
      0,
    );
  } else {
    let bandRows = sectionRows;
    if (session.difficulty) {
      const band = bandForSlug(session.difficulty);
      if (band) {
        bandRows = bandRows.filter((q) => sequenceInBand(q.sequence, band));
      }
    }
    total = bandRows.length;
  }

  return { correct, total, pointsScored, pointsPossible };
}
