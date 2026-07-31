import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/factory";
import { explanations, sessions } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { pointsForSequence } from "../../lib/bands";
import type { Explanation } from "./types";

// spec: docs/specs/quiz-session.md §API contract
// Helpers shared by more than one session module (create / answers / history / detail).

export type SessionRow = typeof sessions.$inferSelect;

// Loading a session by id and 404-ing when it is absent is the first step of every write path.
export async function loadSession(
  db: DbClient,
  sessionId: number,
): Promise<SessionRow> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) {
    throw new ApiError(
      "SESSION_NOT_FOUND",
      `Session ${sessionId} not found.`,
      404,
    );
  }
  return session;
}

// spec: docs/specs/llm-enrichment.md §Behaviour.10 — the stored explanation row as the UI DTO.
export function toExplanation(
  row: typeof explanations.$inferSelect | undefined,
): Explanation | null {
  if (!row) return null;
  return {
    correctReason: row.correctReason,
    optionAReason: row.optionAReason,
    optionBReason: row.optionBReason,
    optionCReason: row.optionCReason,
    optionDReason: row.optionDReason,
  };
}

// spec: docs/specs/quiz-session.md §Results.13 — real-mode points are weighted by sequence position;
// learning mode reports no points at all. Both the history list and the detail view derive them from
// the same recorded-answer rows, so the arithmetic lives here once.
export function pointsFor(rows: { isCorrect: boolean; sequence: number }[]): {
  pointsScored: number;
  pointsPossible: number;
} {
  return {
    pointsScored: rows
      .filter((r) => r.isCorrect)
      .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0),
    pointsPossible: rows.reduce(
      (sum, r) => sum + pointsForSequence(r.sequence),
      0,
    ),
  };
}
