import { asc, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { explanations, options, passages, questionResults, questions, sessions } from '../db/schema';
import { ApiError } from '../lib/errors';
import {
  type DifficultySlug,
  bandForSequence,
  bandForSlug,
  isDifficultySlug,
  pointsForSequence,
  sequenceInBand,
} from '../lib/bands';
import { type Section, getTimeLimitMs } from '../config/exam';

// spec: docs/specs/quiz-session.md §API contract
// Business logic for session lifecycle. Services return plain typed values or throw ApiError;
// the route layer owns the envelope.

export type OptionLabel = 'A' | 'B' | 'C' | 'D';

// UI-facing question shape: deliberately omits `is_correct` so the answer key never leaks to
// the client before the answer is confirmed (the correct label comes from recordAnswer).
export type SessionQuestion = {
  id: number;
  sequence: number;
  text: string;
  passage: { id: number; text: string } | null;
  options: { label: OptionLabel; text: string }[];
};

export type CreateSessionInput = {
  section: Section;
  mode: 'learning' | 'real';
  difficulty?: DifficultySlug;
  questionIds?: number[];
};

export type CreateSessionResult = {
  sessionId: number;
  questions: SessionQuestion[];
  timeLimitMs: number | null;
};

export type Explanation = {
  correctReason: string;
  optionAReason: string;
  optionBReason: string;
  optionCReason: string;
  optionDReason: string;
};

export type RecordAnswerResult =
  | { mode: 'learning'; isCorrect: boolean; correctLabel: OptionLabel; explanation: Explanation | null }
  | { mode: 'real' };

export type CompleteSessionResult = {
  correct: number;
  total: number;
  pointsScored: number | null;
  pointsPossible: number | null;
};

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const { section, mode } = input;

  // In learning mode a valid difficulty band is required (Behaviour.3).
  let band = null;
  if (mode === 'learning') {
    if (!input.difficulty || !isDifficultySlug(input.difficulty)) {
      throw new ApiError('INVALID_DIFFICULTY', 'A valid difficulty is required in learning mode.');
    }
    band = bandForSlug(input.difficulty)!;
  }

  // Resolve the question set in fixed import order (quiz-session §Open questions: TCF uses a
  // fixed order, so no shuffle).
  const sectionQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.section, section))
    .orderBy(asc(questions.sequence));

  let resolved = sectionQuestions;

  // Learning mode restricts to the selected difficulty band's sequence range.
  if (band) {
    resolved = resolved.filter((q) => sequenceInBand(q.sequence, band!));
  }

  // Optional retry filter (review-mode). In learning mode every id must fall within the band.
  if (input.questionIds && input.questionIds.length > 0) {
    const wanted = new Set(input.questionIds);
    if (band) {
      const inBandIds = new Set(resolved.map((q) => q.id));
      const outOfBand = input.questionIds.filter((id) => !inBandIds.has(id));
      if (outOfBand.length > 0) {
        throw new ApiError(
          'QUESTIONS_OUT_OF_BAND',
          `Question(s) ${outOfBand.join(', ')} are not in the ${band.slug} band.`,
        );
      }
    }
    resolved = resolved.filter((q) => wanted.has(q.id));
  }

  if (resolved.length === 0) {
    throw new ApiError('ANSWER_KEY_MISSING', 'No questions are available for this selection.');
  }

  const questionIds = resolved.map((q) => q.id);
  const allOptions = await db
    .select()
    .from(options)
    .where(inArray(options.questionId, questionIds));

  // Group options by question; reject if any resolved question has no correct option imported.
  const optionsByQuestion = new Map<number, typeof allOptions>();
  for (const opt of allOptions) {
    const list = optionsByQuestion.get(opt.questionId) ?? [];
    list.push(opt);
    optionsByQuestion.set(opt.questionId, list);
  }
  for (const q of resolved) {
    const opts = optionsByQuestion.get(q.id) ?? [];
    if (!opts.some((o) => o.isCorrect)) {
      throw new ApiError(
        'ANSWER_KEY_MISSING',
        `Question ${q.sequence} has no imported answer key.`,
      );
    }
  }

  // Load passages for the resolved questions (reading section).
  const passageIds = [
    ...new Set(resolved.map((q) => q.passageId).filter((id): id is number => id != null)),
  ];
  const passageRows = passageIds.length
    ? await db.select().from(passages).where(inArray(passages.id, passageIds))
    : [];
  const passageById = new Map(passageRows.map((p) => [p.id, p]));

  const uiQuestions: SessionQuestion[] = resolved.map((q) => {
    const passage = q.passageId != null ? passageById.get(q.passageId) : undefined;
    const opts = (optionsByQuestion.get(q.id) ?? [])
      .map((o) => ({ label: o.label as OptionLabel, text: o.text }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      id: q.id,
      sequence: q.sequence,
      text: q.text,
      passage: passage ? { id: passage.id, text: passage.text } : null,
      options: opts,
    };
  });

  const [created] = await db
    .insert(sessions)
    .values({
      section,
      mode,
      difficulty: mode === 'learning' ? input.difficulty! : null,
    })
    .returning({ id: sessions.id });

  return {
    sessionId: created.id,
    questions: uiQuestions,
    timeLimitMs: mode === 'real' ? getTimeLimitMs(section) : null,
  };
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
export async function recordAnswer(
  sessionId: number,
  questionId: number,
  chosenLabel: OptionLabel,
): Promise<RecordAnswerResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) {
    throw new ApiError('SESSION_NOT_FOUND', `Session ${sessionId} not found.`, 404);
  }

  const qOptions = await db.select().from(options).where(eq(options.questionId, questionId));
  const correct = qOptions.find((o) => o.isCorrect);
  if (!correct) {
    throw new ApiError('ANSWER_KEY_MISSING', `Question ${questionId} has no answer key.`);
  }

  const isCorrect = chosenLabel === correct.label;
  await db.insert(questionResults).values({ sessionId, questionId, chosenLabel, isCorrect });

  // Real mode returns no correctness feedback (Behaviour.9).
  if (session.mode === 'real') {
    return { mode: 'real' };
  }

  // Learning mode reveals the correct option and bundles the explanation in one JOIN.
  const [exp] = await db
    .select()
    .from(explanations)
    .where(eq(explanations.questionId, questionId));

  return {
    mode: 'learning',
    isCorrect,
    correctLabel: correct.label as OptionLabel,
    explanation: exp
      ? {
          correctReason: exp.correctReason,
          optionAReason: exp.optionAReason,
          optionBReason: exp.optionBReason,
          optionCReason: exp.optionCReason,
          optionDReason: exp.optionDReason,
        }
      : null,
  };
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
export async function completeSession(
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteSessionResult> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) {
    throw new ApiError('SESSION_NOT_FOUND', `Session ${sessionId} not found.`, 404);
  }

  await db
    .update(sessions)
    .set({ completedAt: new Date(), elapsedMs: session.mode === 'real' ? elapsedMs : null })
    .where(eq(sessions.id, sessionId));

  // Correctness comes from the recorded answers joined to question sequences.
  const results = await db
    .select({ isCorrect: questionResults.isCorrect, sequence: questions.sequence })
    .from(questionResults)
    .innerJoin(questions, eq(questionResults.questionId, questions.id))
    .where(eq(questionResults.sessionId, sessionId));

  const correct = results.filter((r) => r.isCorrect).length;

  // `total` reflects the resolved set size (band size in learning, the section in real),
  // recomputed from the section's questions (quiz-session §Results.13).
  const sectionQuestions = await db
    .select({ sequence: questions.sequence })
    .from(questions)
    .where(eq(questions.section, session.section as Section));

  let resolved = sectionQuestions;
  if (session.mode === 'learning' && session.difficulty) {
    const band = bandForSlug(session.difficulty);
    if (band) {
      resolved = resolved.filter((q) => sequenceInBand(q.sequence, band));
    }
  }
  const total = resolved.length;

  // Points only apply in real mode (learning tracks correct/total only — Behaviour.13).
  let pointsScored: number | null = null;
  let pointsPossible: number | null = null;
  if (session.mode === 'real') {
    pointsScored = results
      .filter((r) => r.isCorrect)
      .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
    pointsPossible = resolved.reduce((sum, q) => sum + pointsForSequence(q.sequence), 0);
  }

  return { correct, total, pointsScored, pointsPossible };
}

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
export type SessionSummary = {
  id: number;
  section: string;
  mode: string;
  difficulty: string | null;
  completedAt: string;
  correct: number;
  total: number;
  pointsScored: number | null;
  pointsPossible: number | null;
  elapsedMs: number | null;
};

export async function listSessions(): Promise<SessionSummary[]> {
  const completed = await db
    .select()
    .from(sessions)
    .where(isNotNull(sessions.completedAt))
    .orderBy(desc(sessions.completedAt));

  if (completed.length === 0) return [];

  const sessionIds = completed.map((s) => s.id);

  // Aggregate correct counts per session in one query.
  const correctRows = await db
    .select({ sessionId: questionResults.sessionId, correct: count() })
    .from(questionResults)
    .where(inArray(questionResults.sessionId, sessionIds))
    .groupBy(questionResults.sessionId);

  // Aggregate total counts per session (all recorded answers).
  const totalRows = await db
    .select({ sessionId: questionResults.sessionId, total: count() })
    .from(questionResults)
    .where(inArray(questionResults.sessionId, sessionIds))
    .groupBy(questionResults.sessionId);

  // Points per session require per-question scoring; done per-session from recorded results.
  const allResults = await db
    .select({
      sessionId: questionResults.sessionId,
      isCorrect: questionResults.isCorrect,
      sequence: questions.sequence,
    })
    .from(questionResults)
    .innerJoin(questions, eq(questionResults.questionId, questions.id))
    .where(inArray(questionResults.sessionId, sessionIds));

  const correctBySession = new Map(correctRows.map((r) => [r.sessionId, Number(r.correct)]));
  const totalBySession = new Map(totalRows.map((r) => [r.sessionId, Number(r.total)]));
  const resultsBySession = new Map<number, typeof allResults>();
  for (const r of allResults) {
    const list = resultsBySession.get(r.sessionId) ?? [];
    list.push(r);
    resultsBySession.set(r.sessionId, list);
  }

  return completed.map((s) => {
    const sessionResults = resultsBySession.get(s.id) ?? [];
    let pointsScored: number | null = null;
    let pointsPossible: number | null = null;
    if (s.mode === 'real') {
      pointsScored = sessionResults
        .filter((r) => r.isCorrect)
        .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
      pointsPossible = sessionResults.reduce(
        (sum, r) => sum + pointsForSequence(r.sequence),
        0,
      );
    }
    return {
      id: s.id,
      section: s.section,
      mode: s.mode,
      difficulty: s.difficulty ?? null,
      completedAt: s.completedAt!.toISOString(),
      correct: correctBySession.get(s.id) ?? 0,
      total: totalBySession.get(s.id) ?? 0,
      pointsScored,
      pointsPossible,
      elapsedMs: s.elapsedMs ?? null,
    };
  });
}

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions/:id
// spec: docs/specs/review-mode.md §Behaviour.4–6 — review mode consumes this endpoint, so each
// per-question result carries the full content needed to render the review (question text, passage
// excerpt, all four options, the chosen + correct labels) plus the derived difficulty band (for
// retry grouping) and the LLM explanation — the latter only in learning mode (Behaviour.6).
export type ReviewOption = { label: OptionLabel; text: string };

export type QuestionResultRow = {
  id: number;
  questionId: number;
  sequence: number;
  text: string;
  passage: { text: string } | null;
  options: ReviewOption[];
  chosenLabel: string;
  correctLabel: OptionLabel | null;
  isCorrect: boolean;
  difficulty: DifficultySlug | null;
  explanation: Explanation | null;
  answeredAt: string;
};

export type SessionDetail = {
  session: SessionSummary;
  results: QuestionResultRow[];
};

export async function getSession(sessionId: number): Promise<SessionDetail> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session || session.completedAt == null) {
    throw new ApiError('SESSION_NOT_FOUND', `Session ${sessionId} not found.`, 404);
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

  const correct = rows.filter((r) => r.isCorrect).length;
  const total = rows.length;

  let pointsScored: number | null = null;
  let pointsPossible: number | null = null;
  if (session.mode === 'real') {
    pointsScored = rows
      .filter((r) => r.isCorrect)
      .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
    pointsPossible = rows.reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
  }

  const resultRows = await db
    .select()
    .from(questionResults)
    .where(eq(questionResults.sessionId, sessionId));

  // Enrich each recorded answer with its question content for review mode (review-mode §Behaviour.4).
  const reviewedQuestionIds = resultRows.map((r) => r.questionId);
  const questionRows = reviewedQuestionIds.length
    ? await db.select().from(questions).where(inArray(questions.id, reviewedQuestionIds))
    : [];
  const optionRows = reviewedQuestionIds.length
    ? await db.select().from(options).where(inArray(options.questionId, reviewedQuestionIds))
    : [];
  const passageIds = [
    ...new Set(questionRows.map((q) => q.passageId).filter((id): id is number => id != null)),
  ];
  const passageRows = passageIds.length
    ? await db.select().from(passages).where(inArray(passages.id, passageIds))
    : [];
  // Explanations are a learning-mode feature only (review-mode §Behaviour.6) — skip the query in real mode.
  const explanationRows =
    session.mode === 'learning' && reviewedQuestionIds.length
      ? await db.select().from(explanations).where(inArray(explanations.questionId, reviewedQuestionIds))
      : [];

  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const passageById = new Map(passageRows.map((p) => [p.id, p]));
  const explanationByQuestion = new Map(explanationRows.map((e) => [e.questionId, e]));
  const optionsByQuestion = new Map<number, typeof optionRows>();
  for (const o of optionRows) {
    const list = optionsByQuestion.get(o.questionId) ?? [];
    list.push(o);
    optionsByQuestion.set(o.questionId, list);
  }

  const reviewRows: QuestionResultRow[] = resultRows.map((r) => {
    const q = questionById.get(r.questionId);
    const opts = (optionsByQuestion.get(r.questionId) ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));
    const passage = q?.passageId != null ? passageById.get(q.passageId) : undefined;
    const exp = explanationByQuestion.get(r.questionId);
    return {
      id: r.id,
      questionId: r.questionId,
      sequence: q?.sequence ?? 0,
      text: q?.text ?? '',
      passage: passage ? { text: passage.text } : null,
      options: opts.map((o) => ({ label: o.label as OptionLabel, text: o.text })),
      chosenLabel: r.chosenLabel,
      correctLabel: (opts.find((o) => o.isCorrect)?.label as OptionLabel | undefined) ?? null,
      isCorrect: r.isCorrect,
      difficulty: q ? (bandForSequence(q.sequence)?.slug ?? null) : null,
      explanation: exp
        ? {
            correctReason: exp.correctReason,
            optionAReason: exp.optionAReason,
            optionBReason: exp.optionBReason,
            optionCReason: exp.optionCReason,
            optionDReason: exp.optionDReason,
          }
        : null,
      answeredAt: r.answeredAt.toISOString(),
    };
  });

  // All questions shown in order (review-mode §Behaviour.3) — by import sequence, not answer time.
  reviewRows.sort((a, b) => a.sequence - b.sequence);

  return {
    session: {
      id: session.id,
      section: session.section,
      mode: session.mode,
      difficulty: session.difficulty ?? null,
      completedAt: session.completedAt.toISOString(),
      correct,
      total,
      pointsScored,
      pointsPossible,
      elapsedMs: session.elapsedMs ?? null,
    },
    results: reviewRows,
  };
}
