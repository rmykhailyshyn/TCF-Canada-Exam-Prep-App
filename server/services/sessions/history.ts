import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbClient } from "../../db/factory";
import {
  questionResults,
  questions,
  sessions,
  speakingEvaluations,
  speakingResponses,
  writingEvaluations,
  writingResponses,
} from "../../db/schema";
import { pointsFor } from "./shared";
import type { SessionSummary } from "./types";

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
// The completed-session history list: one row per finished session, aggregated per section family
// (reading/listening report correct/total/points; writing/speaking report a mean per-task /20).

export async function listSessions(db: DbClient): Promise<SessionSummary[]> {
  const completed = await db
    .select()
    .from(sessions)
    .where(isNotNull(sessions.completedAt))
    .orderBy(desc(sessions.completedAt));

  if (completed.length === 0) return [];

  const sessionIds = completed.map((s) => s.id);

  // One query for every recorded answer across the listed sessions; correct / total / points are
  // all derived from it in memory. (Previously three queries, and the "correct" aggregate omitted
  // the is_correct filter — so it equalled total and every history row read N/N.)
  // spec: progress-tracking §Behaviour.6.
  const allResults = await db
    .select({
      sessionId: questionResults.sessionId,
      isCorrect: questionResults.isCorrect,
      sequence: questions.sequence,
    })
    .from(questionResults)
    .innerJoin(questions, eq(questionResults.questionId, questions.id))
    .where(inArray(questionResults.sessionId, sessionIds));

  const resultsBySession = new Map<number, typeof allResults>();
  for (const r of allResults) {
    const list = resultsBySession.get(r.sessionId) ?? [];
    list.push(r);
    resultsBySession.set(r.sessionId, list);
  }

  // spec: docs/specs/progress-tracking.md §Writing & speaking sessions (Behaviour.9) — writing rows
  // carry an overall /20 average + tasks-submitted instead of correct/total/points.
  const writingBySession = await loadWritingAggregates(
    db,
    completed.filter((s) => s.section === "writing").map((s) => s.id),
  );
  // spec: docs/specs/speaking-session.md §Behaviour.17 — speaking rows carry the same overall /20
  // average + tasks-submitted shape as writing (no correct/total/points).
  const speakingBySession = await loadSpeakingAggregates(
    db,
    completed.filter((s) => s.section === "speaking").map((s) => s.id),
  );

  return completed.map((s) => {
    if (s.section === "writing" || s.section === "speaking") {
      const agg = (s.section === "writing"
        ? writingBySession
        : speakingBySession
      ).get(s.id) ?? {
        overallScore: null,
        tasksSubmitted: 0,
      };
      return {
        id: s.id,
        section: s.section,
        mode: s.mode,
        difficulty: null,
        completedAt: s.completedAt!.toISOString(),
        correct: 0,
        total: 0,
        pointsScored: null,
        pointsPossible: null,
        overallScore: agg.overallScore,
        tasksSubmitted: agg.tasksSubmitted,
        elapsedMs: s.elapsedMs ?? null,
      };
    }
    const sessionResults = resultsBySession.get(s.id) ?? [];
    const points = s.mode === "real" ? pointsFor(sessionResults) : null;
    return {
      id: s.id,
      section: s.section,
      mode: s.mode,
      difficulty: s.difficulty ?? null,
      completedAt: s.completedAt!.toISOString(),
      correct: sessionResults.filter((r) => r.isCorrect).length,
      total: sessionResults.length,
      pointsScored: points?.pointsScored ?? null,
      pointsPossible: points?.pointsPossible ?? null,
      overallScore: null,
      tasksSubmitted: null,
      elapsedMs: s.elapsedMs ?? null,
    };
  });
}

export type TaskScoreAggregate = {
  overallScore: number | null;
  tasksSubmitted: number;
};

// spec: docs/specs/progress-tracking.md §Writing & speaking sessions; docs/specs/content-deploy.md
// §Behaviour.7 — the mean of per-task /20 scores (unscored tasks counting 0) and the number of scored
// tasks. The overall score is null (not 0) when NO task is scored, so an online/practice session is
// listed as unscored rather than 0 / 20.
function aggregateBySession(
  rows: { sessionId: number; score: number | null }[],
): Map<number, TaskScoreAggregate> {
  const bySession = new Map<number, (number | null)[]>();
  for (const r of rows) {
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r.score ?? null);
    bySession.set(r.sessionId, list);
  }

  const out = new Map<number, TaskScoreAggregate>();
  for (const [sessionId, scores] of bySession) {
    const tasksSubmitted = scores.filter((s) => s != null).length;
    const sum = scores.reduce<number>((acc, s) => acc + (s ?? 0), 0);
    const overallScore =
      tasksSubmitted === 0 || scores.length === 0
        ? null
        : Math.round(sum / scores.length);
    out.set(sessionId, { overallScore, tasksSubmitted });
  }
  return out;
}

// Per writing session: the per-task /20 aggregate. spec: docs/specs/progress-tracking.md
// §Writing & speaking sessions.
async function loadWritingAggregates(
  db: DbClient,
  sessionIds: number[],
): Promise<Map<number, TaskScoreAggregate>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({
      sessionId: writingResponses.sessionId,
      score: writingEvaluations.score,
    })
    .from(writingResponses)
    .leftJoin(
      writingEvaluations,
      eq(writingEvaluations.responseId, writingResponses.id),
    )
    .where(inArray(writingResponses.sessionId, sessionIds));
  return aggregateBySession(rows);
}

// Per speaking session: the same per-task /20 aggregate as writing.
// spec: docs/specs/speaking-session.md §Behaviour.17.
async function loadSpeakingAggregates(
  db: DbClient,
  sessionIds: number[],
): Promise<Map<number, TaskScoreAggregate>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .select({
      sessionId: speakingResponses.sessionId,
      score: speakingEvaluations.score,
    })
    .from(speakingResponses)
    .leftJoin(
      speakingEvaluations,
      eq(speakingEvaluations.responseId, speakingResponses.id),
    )
    .where(inArray(speakingResponses.sessionId, sessionIds));
  return aggregateBySession(rows);
}
