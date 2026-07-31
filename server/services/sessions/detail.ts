import { eq, inArray } from "drizzle-orm";
import type { DbClient } from "../../db/factory";
import {
  explanations,
  options,
  passages,
  questionResults,
  questions,
} from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { bandForSequence } from "../../lib/bands";
import { loadSession, pointsFor, toExplanation } from "./shared";
import type { OptionLabel, QuestionResultRow, SessionDetail } from "./types";

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions/:id
// spec: docs/specs/review-mode.md §Behaviour.3–6 — the completed-session read-back that review mode
// renders: every recorded answer enriched with its question content, options, chosen + correct
// labels, derived difficulty band (for retry grouping) and the LLM explanation.

export async function getSession(
  db: DbClient,
  sessionId: number,
): Promise<SessionDetail> {
  const session = await loadSession(db, sessionId);
  if (session.completedAt == null) {
    throw new ApiError(
      "SESSION_NOT_FOUND",
      `Session ${sessionId} not found.`,
      404,
    );
  }

  const rows = await db
    .select({
      sessionId: questionResults.sessionId,
      isCorrect: questionResults.isCorrect,
      sequence: questions.sequence,
    })
    .from(questionResults)
    .innerJoin(questions, eq(questionResults.questionId, questions.id))
    .where(eq(questionResults.sessionId, sessionId));

  const points = session.mode === "real" ? pointsFor(rows) : null;
  const resultRows = await db
    .select()
    .from(questionResults)
    .where(eq(questionResults.sessionId, sessionId));

  const reviewRows = await loadReviewRows(db, resultRows);
  // All questions shown in order (review-mode §Behaviour.3) — by import sequence, not answer time.
  reviewRows.sort((a, b) => a.sequence - b.sequence);

  return {
    session: {
      id: session.id,
      section: session.section,
      mode: session.mode,
      difficulty: session.difficulty ?? null,
      completedAt: session.completedAt.toISOString(),
      correct: rows.filter((r) => r.isCorrect).length,
      total: rows.length,
      pointsScored: points?.pointsScored ?? null,
      pointsPossible: points?.pointsPossible ?? null,
      overallScore: null,
      tasksSubmitted: null,
      elapsedMs: session.elapsedMs ?? null,
    },
    results: reviewRows,
  };
}

type ResultRow = typeof questionResults.$inferSelect;

// Enrich each recorded answer with its question content for review mode (review-mode §Behaviour.4).
// Explanations surface in review for BOTH learning and real sessions (llm-enrichment §Behaviour.10
// supersedes review-mode §Behaviour.6): they're shown after a real exam, never during it.
async function loadReviewRows(
  db: DbClient,
  resultRows: ResultRow[],
): Promise<QuestionResultRow[]> {
  const reviewedQuestionIds = resultRows.map((r) => r.questionId);
  const questionRows = reviewedQuestionIds.length
    ? await db
        .select()
        .from(questions)
        .where(inArray(questions.id, reviewedQuestionIds))
    : [];
  const optionRows = reviewedQuestionIds.length
    ? await db
        .select()
        .from(options)
        .where(inArray(options.questionId, reviewedQuestionIds))
    : [];
  const passageIds = [
    ...new Set(
      questionRows
        .map((q) => q.passageId)
        .filter((id): id is number => id != null),
    ),
  ];
  const passageRows = passageIds.length
    ? await db.select().from(passages).where(inArray(passages.id, passageIds))
    : [];
  const explanationRows = reviewedQuestionIds.length
    ? await db
        .select()
        .from(explanations)
        .where(inArray(explanations.questionId, reviewedQuestionIds))
    : [];

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const passageById = new Map(passageRows.map((p) => [p.id, p]));
  const explanationByQuestion = new Map(
    explanationRows.map((e) => [e.questionId, e]),
  );
  const optionsByQuestion = new Map<number, typeof optionRows>();
  for (const o of optionRows) {
    const list = optionsByQuestion.get(o.questionId) ?? [];
    list.push(o);
    optionsByQuestion.set(o.questionId, list);
  }

  return resultRows.map((r) => {
    const q = questionById.get(r.questionId);
    const opts = (optionsByQuestion.get(r.questionId) ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
    const passage =
      q?.passageId != null ? passageById.get(q.passageId) : undefined;
    return {
      id: r.id,
      questionId: r.questionId,
      sequence: q?.sequence ?? 0,
      text: q?.text ?? "",
      passage: passage ? { text: passage.text } : null,
      options: opts.map((o) => ({
        label: o.label as OptionLabel,
        text: o.text,
      })),
      chosenLabel: r.chosenLabel,
      correctLabel:
        (opts.find((o) => o.isCorrect)?.label as OptionLabel | undefined) ??
        null,
      isCorrect: r.isCorrect,
      difficulty: q ? (bandForSequence(q.sequence)?.slug ?? null) : null,
      explanation: toExplanation(explanationByQuestion.get(r.questionId)),
      answeredAt: r.answeredAt.toISOString(),
    };
  });
}
