import { asc, eq, inArray } from "drizzle-orm";
import type { DbClient } from "../../db/factory";
import { options, passages, questions, sessions } from "../../db/schema";
import { ApiError } from "../../lib/errors";
import { bandForSlug, isDifficultySlug, sequenceInBand } from "../../lib/bands";
import { getTimeLimitMs } from "../../config/exam";
import { pickOne, shuffle } from "../../lib/random";
import type {
  CreateSessionInput,
  CreateSessionResult,
  OptionLabel,
  SessionQuestion,
} from "./types";

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
// Question selection + session creation. Services return plain typed values or throw ApiError;
// the route layer owns the envelope.

export async function createSession(
  db: DbClient,
  input: CreateSessionInput,
): Promise<CreateSessionResult> {
  const { section, mode } = input;

  // In learning mode a valid difficulty band is required (Behaviour.3).
  let band = null;
  if (mode === "learning") {
    if (!input.difficulty || !isDifficultySlug(input.difficulty)) {
      throw new ApiError(
        "INVALID_DIFFICULTY",
        "A valid difficulty is required in learning mode.",
      );
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
    ? await db
        .select()
        .from(options)
        .where(inArray(options.questionId, sectionIds))
    : [];
  const optionsByQuestion = new Map<number, typeof allOptions>();
  for (const opt of allOptions) {
    const list = optionsByQuestion.get(opt.questionId) ?? [];
    list.push(opt);
    optionsByQuestion.set(opt.questionId, list);
  }
  const isKeyed = (questionId: number): boolean =>
    (optionsByQuestion.get(questionId) ?? []).some((o) => o.isCorrect);

  const resolved = band
    ? resolveLearningQuestions(sectionQuestions, band, input, isKeyed)
    : resolveRealQuestions(sectionQuestions, isKeyed);

  if (resolved.length === 0) {
    throw new ApiError(
      "ANSWER_KEY_MISSING",
      "No questions are available for this selection.",
    );
  }

  // Load passages for the resolved questions (reading section).
  const passageIds = [
    ...new Set(
      resolved.map((q) => q.passageId).filter((id): id is number => id != null),
    ),
  ];
  const passageRows = passageIds.length
    ? await db.select().from(passages).where(inArray(passages.id, passageIds))
    : [];
  const passageById = new Map(passageRows.map((p) => [p.id, p]));

  const uiQuestions: SessionQuestion[] = resolved.map((q) => {
    const passage =
      q.passageId != null ? passageById.get(q.passageId) : undefined;
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
      difficulty: mode === "learning" ? input.difficulty! : null,
    })
    .returning({ id: sessions.id });

  return {
    sessionId: created.id,
    questions: uiQuestions,
    timeLimitMs: mode === "real" ? getTimeLimitMs(section) : null,
  };
}

type QuestionRow = typeof questions.$inferSelect;
type Band = NonNullable<ReturnType<typeof bandForSlug>>;

// spec: docs/specs/quiz-session.md §Behaviour.21 — learning mode practises the band's questions in
// RANDOM order. All band questions are kept (including multiple candidates that share a sequence
// position) — only the presentation order is shuffled, no per-position pruning.
function resolveLearningQuestions(
  sectionQuestions: QuestionRow[],
  band: Band,
  input: CreateSessionInput,
  isKeyed: (questionId: number) => boolean,
): QuestionRow[] {
  let bandQuestions = sectionQuestions.filter((q) =>
    sequenceInBand(q.sequence, band),
  );

  // Optional retry filter (review-mode). Every supplied id must fall within the band.
  if (input.questionIds && input.questionIds.length > 0) {
    const inBandIds = new Set(bandQuestions.map((q) => q.id));
    const outOfBand = input.questionIds.filter((id) => !inBandIds.has(id));
    if (outOfBand.length > 0) {
      throw new ApiError(
        "QUESTIONS_OUT_OF_BAND",
        `Question(s) ${outOfBand.join(", ")} are not in the ${band.slug} band.`,
      );
    }
    const wanted = new Set(input.questionIds);
    bandQuestions = bandQuestions.filter((q) => wanted.has(q.id));
  }

  // Every band question must have an imported answer key (API contract — learning mode).
  for (const q of bandQuestions) {
    if (!isKeyed(q.id)) {
      throw new ApiError(
        "ANSWER_KEY_MISSING",
        `Question ${q.sequence} has no imported answer key.`,
      );
    }
  }

  return shuffle(bandQuestions);
}

// spec: docs/specs/quiz-session.md §Behaviour.19–20 — real mode builds the exam by drawing ONE random
// keyed question per occupied sequence position, presented in ascending sequence order.
function resolveRealQuestions(
  sectionQuestions: QuestionRow[],
  isKeyed: (questionId: number) => boolean,
): QuestionRow[] {
  const keyedByPosition = new Map<number, QuestionRow[]>();
  for (const q of sectionQuestions) {
    if (!isKeyed(q.id)) continue;
    const list = keyedByPosition.get(q.sequence) ?? [];
    list.push(q);
    keyedByPosition.set(q.sequence, list);
  }

  // Every occupied position (one holding any question) must have at least one keyed candidate,
  // otherwise the exam can't be formed for that position (API contract — real mode).
  const occupiedPositions = [
    ...new Set(sectionQuestions.map((q) => q.sequence)),
  ].sort((a, b) => a - b);
  for (const pos of occupiedPositions) {
    if (!keyedByPosition.has(pos)) {
      throw new ApiError(
        "ANSWER_KEY_MISSING",
        `Question ${pos} has no imported answer key.`,
      );
    }
  }

  return occupiedPositions.map((pos) => pickOne(keyedByPosition.get(pos)!));
}
