import type { DifficultySlug, QuestionResultRow } from "../../lib/api";
import { DIFFICULTY_BANDS } from "../../lib/bands";

// spec: docs/specs/review-mode.md §Behaviour.8–9
// Groups a session's incorrectly-answered questions by their difficulty band so retry can issue
// one learning-mode session per affected band. Bands are returned in canonical order
// (Beginner → Expert) so the "affected bands" list (Behaviour.9) reads consistently.

export type RetryBand = {
  difficulty: DifficultySlug;
  questionIds: number[];
  count: number;
};

export function groupIncorrectByBand(
  results: QuestionResultRow[],
): RetryBand[] {
  const idsByBand = new Map<DifficultySlug, number[]>();
  for (const r of results) {
    if (r.isCorrect || r.difficulty == null) continue;
    const list = idsByBand.get(r.difficulty) ?? [];
    list.push(r.questionId);
    idsByBand.set(r.difficulty, list);
  }
  return DIFFICULTY_BANDS.filter((b) => idsByBand.has(b.slug)).map((b) => {
    const questionIds = idsByBand.get(b.slug)!;
    return { difficulty: b.slug, questionIds, count: questionIds.length };
  });
}
