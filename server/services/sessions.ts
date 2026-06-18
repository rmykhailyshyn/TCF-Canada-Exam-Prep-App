import { asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import {
  explanations,
  options,
  passages,
  questionResults,
  questions,
  sessions,
  writingEvaluations,
  writingResponses,
} from '../db/schema';
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
import { pickOne, shuffle } from '../lib/random';

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

  // Load all questions in the section (ascending by sequence) plus their options up front. Options
  // are needed both to detect a missing answer key and — in real mode — to draw the per-position
  // pick only from questions that actually carry a key (quiz-session §Question selection.19–21).
  const sectionQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.section, section))
    .orderBy(asc(questions.sequence));

  const sectionIds = sectionQuestions.map((q) => q.id);
  const allOptions = sectionIds.length
    ? await db.select().from(options).where(inArray(options.questionId, sectionIds))
    : [];
  const optionsByQuestion = new Map<number, typeof allOptions>();
  for (const opt of allOptions) {
    const list = optionsByQuestion.get(opt.questionId) ?? [];
    list.push(opt);
    optionsByQuestion.set(opt.questionId, list);
  }
  const isKeyed = (questionId: number): boolean =>
    (optionsByQuestion.get(questionId) ?? []).some((o) => o.isCorrect);

  let resolved: typeof sectionQuestions;

  if (band) {
    // Learning mode: the band's questions in RANDOM order (Behaviour.21). All band questions are
    // kept (including multiple candidates that share a sequence position) — only the presentation
    // order is shuffled, no per-position pruning.
    let bandQuestions = sectionQuestions.filter((q) => sequenceInBand(q.sequence, band!));

    // Optional retry filter (review-mode). Every supplied id must fall within the band.
    if (input.questionIds && input.questionIds.length > 0) {
      const inBandIds = new Set(bandQuestions.map((q) => q.id));
      const outOfBand = input.questionIds.filter((id) => !inBandIds.has(id));
      if (outOfBand.length > 0) {
        throw new ApiError(
          'QUESTIONS_OUT_OF_BAND',
          `Question(s) ${outOfBand.join(', ')} are not in the ${band.slug} band.`,
        );
      }
      const wanted = new Set(input.questionIds);
      bandQuestions = bandQuestions.filter((q) => wanted.has(q.id));
    }

    // Every band question must have an imported answer key (API contract — learning mode).
    for (const q of bandQuestions) {
      if (!isKeyed(q.id)) {
        throw new ApiError('ANSWER_KEY_MISSING', `Question ${q.sequence} has no imported answer key.`);
      }
    }

    resolved = shuffle(bandQuestions);
  } else {
    // Real mode: build the exam by drawing ONE random keyed question per occupied sequence
    // position, then presenting them in ascending sequence order (Behaviour.19–20).
    const keyedByPosition = new Map<number, typeof sectionQuestions>();
    for (const q of sectionQuestions) {
      if (!isKeyed(q.id)) continue;
      const list = keyedByPosition.get(q.sequence) ?? [];
      list.push(q);
      keyedByPosition.set(q.sequence, list);
    }

    // Every occupied position (one holding any question) must have at least one keyed candidate,
    // otherwise the exam can't be formed for that position (API contract — real mode).
    const occupiedPositions = [...new Set(sectionQuestions.map((q) => q.sequence))].sort(
      (a, b) => a - b,
    );
    for (const pos of occupiedPositions) {
      if (!keyedByPosition.has(pos)) {
        throw new ApiError('ANSWER_KEY_MISSING', `Question ${pos} has no imported answer key.`);
      }
    }

    resolved = occupiedPositions.map((pos) => pickOne(keyedByPosition.get(pos)!));
  }

  if (resolved.length === 0) {
    throw new ApiError('ANSWER_KEY_MISSING', 'No questions are available for this selection.');
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
  if (session.mode === 'real') {
    const positions = [...new Set(sectionRows.map((q) => q.sequence))];
    total = positions.length;
    pointsScored = results
      .filter((r) => r.isCorrect)
      .reduce((sum, r) => sum + pointsForSequence(r.sequence), 0);
    pointsPossible = positions.reduce((sum, pos) => sum + pointsForSequence(pos), 0);
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

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
// `overallScore` / `tasksSubmitted` are populated for writing sessions (mean per-task /20 + answered
// count) and null for reading/listening; `correct` / `total` / points are the reverse.
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
  overallScore: number | null;
  tasksSubmitted: number | null;
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
    completed.filter((s) => s.section === 'writing').map((s) => s.id),
  );

  return completed.map((s) => {
    if (s.section === 'writing') {
      const agg = writingBySession.get(s.id) ?? { overallScore: 0, tasksSubmitted: 0 };
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
    const correct = sessionResults.filter((r) => r.isCorrect).length;
    const total = sessionResults.length;
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
      correct,
      total,
      pointsScored,
      pointsPossible,
      overallScore: null,
      tasksSubmitted: null,
      elapsedMs: s.elapsedMs ?? null,
    };
  });
}

// Per writing session: the mean of per-task /20 scores (unscored tasks counting 0) and the number of
// scored tasks. spec: docs/specs/progress-tracking.md §Writing & speaking sessions.
async function loadWritingAggregates(
  sessionIds: number[],
): Promise<Map<number, { overallScore: number; tasksSubmitted: number }>> {
  const out = new Map<number, { overallScore: number; tasksSubmitted: number }>();
  if (sessionIds.length === 0) return out;

  const rows = await db
    .select({
      sessionId: writingResponses.sessionId,
      score: writingEvaluations.score,
    })
    .from(writingResponses)
    .leftJoin(writingEvaluations, eq(writingEvaluations.responseId, writingResponses.id))
    .where(inArray(writingResponses.sessionId, sessionIds));

  const bySession = new Map<number, (number | null)[]>();
  for (const r of rows) {
    const list = bySession.get(r.sessionId) ?? [];
    list.push(r.score ?? null);
    bySession.set(r.sessionId, list);
  }

  for (const [sessionId, scores] of bySession) {
    const tasksSubmitted = scores.filter((s) => s != null).length;
    const sum = scores.reduce<number>((acc, s) => acc + (s ?? 0), 0);
    const overallScore = scores.length ? Math.round(sum / scores.length) : 0;
    out.set(sessionId, { overallScore, tasksSubmitted });
  }
  return out;
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
  // Explanations surface in review for BOTH learning and real sessions (llm-enrichment §Behaviour.10
  // supersedes review-mode §Behaviour.6): they're shown after a real exam, never during it.
  const explanationRows = reviewedQuestionIds.length
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
      overallScore: null,
      tasksSubmitted: null,
      elapsedMs: session.elapsedMs ?? null,
    },
    results: reviewRows,
  };
}
