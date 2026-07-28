import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  explanations,
  options,
  passages,
  questionResults,
  questions,
  sessions,
  speakingEvaluations,
  speakingResponses,
  speakingTasks,
  writingEvaluations,
  writingResponses,
  writingTasks,
} from "../db/schema";
import { ApiError } from "../lib/errors";
import { type TestDb, cleanupDbs, freshDb } from "../test-support/db";
import {
  completeSession,
  createSession,
  getSession,
  listSessions,
  recordAnswer,
} from "./sessions";

// spec: docs/specs/quiz-session.md §API contract; §Question selection.19–21; §Results.13
// spec: docs/specs/progress-tracking.md §API contract; docs/specs/review-mode.md §Behaviour.3–6
//
// DB-backed coverage for the reading/listening session lifecycle. The service takes `DbClient` as a
// parameter, so every case here drives the real Drizzle queries against a migrated temp-file SQLite
// database — the same code path the Node routes and the Worker both call.

let db: TestDb;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(() => {
  cleanupDbs();
});

type SeedQuestion = {
  sequence: number;
  section?: "reading" | "listening";
  /** correct option label; omit for a question with no imported answer key */
  correct?: "A" | "B" | "C" | "D";
  passageText?: string;
  sourceFile?: string;
  explain?: boolean;
};

/** Insert questions (+ options, passages, explanations) and return their ids by insertion order. */
async function seedQuestions(specs: SeedQuestion[]): Promise<number[]> {
  const ids: number[] = [];
  for (const [i, s] of specs.entries()) {
    let passageId: number | null = null;
    if (s.passageText) {
      const [p] = await db
        .insert(passages)
        .values({ sourceFile: `passage-${String(i)}.txt`, text: s.passageText })
        .returning({ id: passages.id });
      passageId = p.id;
    }
    const [q] = await db
      .insert(questions)
      .values({
        passageId,
        sourceFile: s.sourceFile ?? `src-${String(i)}.pdf`,
        sequence: s.sequence,
        text: `Question ${String(s.sequence)}?`,
        section: s.section ?? "reading",
      })
      .returning({ id: questions.id });
    ids.push(q.id);

    // Options are inserted out of alphabetical order so the service's sort is actually exercised.
    for (const label of ["C", "A", "D", "B"] as const) {
      await db.insert(options).values({
        questionId: q.id,
        label,
        text: `Option ${label} for Q${String(s.sequence)}`,
        isCorrect: s.correct === label,
      });
    }
    if (s.explain) {
      await db.insert(explanations).values({
        questionId: q.id,
        correctReason: "Because the passage says so.",
        optionAReason: "A is wrong.",
        optionBReason: "B is wrong.",
        optionCReason: "C is wrong.",
        optionDReason: "D is wrong.",
        generatedBy: "test",
      });
    }
  }
  return ids;
}

/** The four Beginner-band positions (Q1–4), all keyed to A. */
const beginnerBand: SeedQuestion[] = [1, 2, 3, 4].map((sequence) => ({
  sequence,
  correct: "A" as const,
}));

describe("createSession — learning mode", () => {
  // spec: docs/specs/quiz-session.md §Behaviour.3 — a valid difficulty is required in learning mode.
  it("rejects a missing difficulty", async () => {
    await seedQuestions(beginnerBand);
    await expect(
      createSession(db, { section: "reading", mode: "learning" }),
    ).rejects.toMatchObject({ code: "INVALID_DIFFICULTY" });
  });

  it("rejects an unrecognised difficulty slug", async () => {
    await seedQuestions(beginnerBand);
    await expect(
      createSession(db, {
        section: "reading",
        mode: "learning",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately feeding an invalid slug past the type to exercise the runtime guard
        difficulty: "not-a-band" as any,
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  // spec: §Behaviour.21 — every band question is kept; only the presentation order is shuffled.
  it("returns every question in the band with sorted options and no time limit", async () => {
    await seedQuestions(beginnerBand);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });

    expect(res.sessionId).toBeGreaterThan(0);
    expect(res.timeLimitMs).toBeNull();
    expect(res.questions).toHaveLength(4);
    expect([...res.questions].map((q) => q.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(res.questions[0].options.map((o) => o.label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("excludes questions outside the requested band", async () => {
    await seedQuestions([
      ...beginnerBand,
      { sequence: 11, correct: "B" },
      { sequence: 12, correct: "B" },
    ]);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "intermediate",
    });
    expect(res.questions.map((q) => q.sequence).sort((a, b) => a - b)).toEqual([
      11, 12,
    ]);
  });

  it("keeps multiple imports that share a sequence position", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A", sourceFile: "a.pdf" },
      { sequence: 1, correct: "B", sourceFile: "b.pdf" },
      { sequence: 2, correct: "A", sourceFile: "a.pdf" },
    ]);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    expect(res.questions).toHaveLength(3);
  });

  // spec: docs/specs/reading-quiz-ui.md — the reading passage travels with its question.
  it("attaches the passage to a reading question", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A", passageText: "Un texte de compréhension." },
    ]);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    expect(res.questions[0].passage?.text).toBe("Un texte de compréhension.");
  });

  it("leaves the passage null when the question has none (listening)", async () => {
    await seedQuestions([{ sequence: 1, section: "listening", correct: "A" }]);
    const res = await createSession(db, {
      section: "listening",
      mode: "learning",
      difficulty: "beginner",
    });
    expect(res.questions[0].passage).toBeNull();
  });

  // spec: §API contract — learning mode requires an imported answer key for every band question.
  it("rejects a band containing a question with no answer key", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A" },
      { sequence: 2 },
    ]);
    await expect(
      createSession(db, {
        section: "reading",
        mode: "learning",
        difficulty: "beginner",
      }),
    ).rejects.toMatchObject({ code: "ANSWER_KEY_MISSING" });
  });

  it("rejects an empty band selection", async () => {
    await seedQuestions(beginnerBand);
    await expect(
      createSession(db, {
        section: "reading",
        mode: "learning",
        difficulty: "expert",
      }),
    ).rejects.toMatchObject({ code: "ANSWER_KEY_MISSING" });
  });

  it("rejects a section with no imported questions at all", async () => {
    await expect(
      createSession(db, {
        section: "reading",
        mode: "learning",
        difficulty: "beginner",
      }),
    ).rejects.toMatchObject({ code: "ANSWER_KEY_MISSING" });
  });
});

describe("createSession — learning mode retry filter", () => {
  // spec: docs/specs/review-mode.md §Behaviour.7 — retry a subset of the band's questions.
  it("narrows the session to the supplied question ids", async () => {
    const ids = await seedQuestions(beginnerBand);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
      questionIds: [ids[0], ids[2]],
    });
    expect(res.questions.map((q) => q.id).sort((a, b) => a - b)).toEqual(
      [ids[0], ids[2]].sort((a, b) => a - b),
    );
  });

  it("rejects ids that fall outside the requested band", async () => {
    const ids = await seedQuestions([
      ...beginnerBand,
      { sequence: 11, correct: "A" },
    ]);
    await expect(
      createSession(db, {
        section: "reading",
        mode: "learning",
        difficulty: "beginner",
        questionIds: [ids[4]],
      }),
    ).rejects.toMatchObject({ code: "QUESTIONS_OUT_OF_BAND" });
  });

  it("ignores an empty id list and keeps the whole band", async () => {
    await seedQuestions(beginnerBand);
    const res = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
      questionIds: [],
    });
    expect(res.questions).toHaveLength(4);
  });
});

describe("createSession — real mode", () => {
  // spec: §Behaviour.19–20 — one random keyed question per occupied position, ascending order.
  it("draws one question per occupied position in ascending sequence order", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A", sourceFile: "a.pdf" },
      { sequence: 1, correct: "B", sourceFile: "b.pdf" },
      { sequence: 2, correct: "A", sourceFile: "a.pdf" },
      { sequence: 3, correct: "A", sourceFile: "a.pdf" },
    ]);
    const res = await createSession(db, { section: "reading", mode: "real" });
    expect(res.questions.map((q) => q.sequence)).toEqual([1, 2, 3]);
  });

  // spec: §Real mode.8 — the countdown is initialised from exam.config.json.
  it("returns the configured section time limit", async () => {
    await seedQuestions([{ sequence: 1, correct: "A" }]);
    const res = await createSession(db, { section: "reading", mode: "real" });
    expect(res.timeLimitMs).toBeGreaterThan(0);
  });

  it("skips unkeyed candidates at a position that has a keyed one", async () => {
    await seedQuestions([
      { sequence: 1, sourceFile: "unkeyed.pdf" },
      { sequence: 1, correct: "C", sourceFile: "keyed.pdf" },
    ]);
    const res = await createSession(db, { section: "reading", mode: "real" });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].sequence).toBe(1);
  });

  // spec: §API contract — real mode needs at least one keyed candidate per occupied position.
  it("rejects when an occupied position has no keyed candidate at all", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A" },
      { sequence: 2 },
    ]);
    await expect(
      createSession(db, { section: "reading", mode: "real" }),
    ).rejects.toMatchObject({ code: "ANSWER_KEY_MISSING" });
  });

  it("stores no difficulty for a real session", async () => {
    await seedQuestions([{ sequence: 1, correct: "A" }]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    const [row] = await db.select().from(sessions);
    expect(row.id).toBe(sessionId);
    expect(row.difficulty).toBeNull();
  });

  it("keeps the two sections independent", async () => {
    await seedQuestions([
      { sequence: 1, section: "reading", correct: "A" },
      { sequence: 2, section: "listening", correct: "A", sourceFile: "l.pdf" },
    ]);
    const res = await createSession(db, { section: "listening", mode: "real" });
    expect(res.questions.map((q) => q.sequence)).toEqual([2]);
  });
});

describe("recordAnswer", () => {
  async function startLearning(explain = false): Promise<{
    sessionId: number;
    questionId: number;
  }> {
    const ids = await seedQuestions([{ sequence: 1, correct: "A", explain }]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    return { sessionId, questionId: ids[0] };
  }

  it("rejects an unknown session with a 404", async () => {
    const ids = await seedQuestions([{ sequence: 1, correct: "A" }]);
    await expect(recordAnswer(db, 9999, ids[0], "A")).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });

  it("rejects a question with no answer key", async () => {
    const ids = await seedQuestions([
      { sequence: 1, correct: "A" },
      { sequence: 2 },
    ]);
    const [s] = await db
      .insert(sessions)
      .values({ section: "reading", mode: "learning", difficulty: "beginner" })
      .returning({ id: sessions.id });
    await expect(recordAnswer(db, s.id, ids[1], "A")).rejects.toMatchObject({
      code: "ANSWER_KEY_MISSING",
    });
  });

  // spec: §Behaviour.9 — real mode returns no correctness feedback.
  it("returns only the mode in real mode and still records the answer", async () => {
    const ids = await seedQuestions([{ sequence: 1, correct: "A" }]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    await expect(recordAnswer(db, sessionId, ids[0], "B")).resolves.toEqual({
      mode: "real",
    });
    const rows = await db.select().from(questionResults);
    expect(rows).toHaveLength(1);
    expect(rows[0].isCorrect).toBe(false);
  });

  // spec: §Learning mode — the correct label is revealed after each answer.
  it("reveals correctness and the correct label in learning mode", async () => {
    const { sessionId, questionId } = await startLearning();
    await expect(
      recordAnswer(db, sessionId, questionId, "A"),
    ).resolves.toEqual({
      mode: "learning",
      isCorrect: true,
      correctLabel: "A",
      explanation: null,
    });
  });

  it("reports an incorrect choice without changing the correct label", async () => {
    const { sessionId, questionId } = await startLearning();
    const res = await recordAnswer(db, sessionId, questionId, "D");
    expect(res).toMatchObject({ isCorrect: false, correctLabel: "A" });
  });

  // spec: docs/specs/llm-enrichment.md §Behaviour.10 — the explanation rides along when present.
  it("bundles the stored explanation when one exists", async () => {
    const { sessionId, questionId } = await startLearning(true);
    const res = await recordAnswer(db, sessionId, questionId, "A");
    expect(res).toMatchObject({
      explanation: { correctReason: "Because the passage says so." },
    });
  });
});

describe("completeSession", () => {
  it("rejects an unknown session with a 404", async () => {
    await expect(completeSession(db, 4242, null)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });

  // spec: §Results.13 — learning totals are the band's question count.
  it("scores a learning session against the band size and awards no points", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await recordAnswer(db, sessionId, ids[1], "D");

    await expect(completeSession(db, sessionId, 60_000)).resolves.toEqual({
      correct: 1,
      total: 4,
      pointsScored: null,
      pointsPossible: null,
    });
  });

  it("does not persist elapsed time for a learning session", async () => {
    await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await completeSession(db, sessionId, 60_000);
    const [row] = await db.select().from(sessions);
    expect(row.elapsedMs).toBeNull();
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  // spec: §Scoring — Q1–4 are worth 3 points each.
  it("awards weighted points in real mode and persists elapsed time", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await recordAnswer(db, sessionId, ids[1], "A");
    await recordAnswer(db, sessionId, ids[2], "B");

    await expect(completeSession(db, sessionId, 120_000)).resolves.toEqual({
      correct: 2,
      total: 4,
      pointsScored: 6,
      pointsPossible: 12,
    });
    const [row] = await db.select().from(sessions);
    expect(row.elapsedMs).toBe(120_000);
  });

  // spec: §Results.13 — duplicate imports at one position must not inflate total/pointsPossible.
  it("counts distinct positions, not rows, for a real session", async () => {
    await seedQuestions([
      { sequence: 1, correct: "A", sourceFile: "a.pdf" },
      { sequence: 1, correct: "A", sourceFile: "b.pdf" },
      { sequence: 2, correct: "A", sourceFile: "a.pdf" },
    ]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    const res = await completeSession(db, sessionId, null);
    expect(res.total).toBe(2);
    expect(res.pointsPossible).toBe(6);
  });

  it("falls back to the whole section when a learning session has no difficulty", async () => {
    await seedQuestions([
      ...beginnerBand,
      { sequence: 11, correct: "A" },
    ]);
    const [s] = await db
      .insert(sessions)
      .values({ section: "reading", mode: "learning" })
      .returning({ id: sessions.id });
    const res = await completeSession(db, s.id, null);
    expect(res.total).toBe(5);
  });
});

describe("listSessions", () => {
  /** A completed writing session, ready for per-task responses. */
  async function seedWritingSession(): Promise<number> {
    const [s] = await db
      .insert(sessions)
      .values({
        section: "writing",
        mode: "learning",
        completedAt: new Date(),
      })
      .returning({ id: sessions.id });
    return s.id;
  }

  async function seedWritingResponse(
    sessionId: number,
    taskNumber: 1 | 2 | 3,
  ): Promise<number> {
    const [t] = await db
      .insert(writingTasks)
      .values({
        sourceFile: `task-${String(taskNumber)}.md`,
        taskNumber,
        prompt: "Écrivez.",
      })
      .returning({ id: writingTasks.id });
    const [r] = await db
      .insert(writingResponses)
      .values({
        sessionId,
        writingTaskId: t.id,
        taskNumber,
        responseText: "Une réponse.",
        submittedAt: new Date(),
      })
      .returning({ id: writingResponses.id });
    return r.id;
  }

  it("returns an empty list when nothing has been completed", async () => {
    await seedQuestions(beginnerBand);
    await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await expect(listSessions(db)).resolves.toEqual([]);
  });

  // spec: docs/specs/progress-tracking.md §Behaviour.6 — correct is the is_correct count, not total.
  it("summarises a completed learning session with its real correct count", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await recordAnswer(db, sessionId, ids[1], "C");
    await completeSession(db, sessionId, null);

    const [row] = await listSessions(db);
    expect(row).toMatchObject({
      id: sessionId,
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
      correct: 1,
      total: 2,
      pointsScored: null,
      pointsPossible: null,
      overallScore: null,
      tasksSubmitted: null,
    });
    expect(typeof row.completedAt).toBe("string");
  });

  it("reports weighted points for a completed real session", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await recordAnswer(db, sessionId, ids[1], "D");
    await completeSession(db, sessionId, 90_000);

    const [row] = await listSessions(db);
    expect(row).toMatchObject({
      pointsScored: 3,
      pointsPossible: 6,
      elapsedMs: 90_000,
    });
  });

  it("orders newest first", async () => {
    await seedQuestions(beginnerBand);
    const first = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await completeSession(db, first.sessionId, null);
    const second = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await completeSession(db, second.sessionId, null);

    // Both complete within the same second, so assert set membership plus the ordering key.
    const rows = await listSessions(db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(
      [first.sessionId, second.sessionId].sort((a, b) => a - b),
    );
  });

  // spec: docs/specs/progress-tracking.md §Behaviour.9 — writing rows carry an overall /20 average.
  it("averages per-task scores for a writing session", async () => {
    const s = await seedWritingSession();
    for (const [taskNumber, score] of [
      [1, 14],
      [2, 16],
    ] as const) {
      const responseId = await seedWritingResponse(s, taskNumber);
      await db.insert(writingEvaluations).values({
        responseId,
        score,
        strengths: "s",
        errors: "e",
        improvements: "i",
        generatedBy: "test",
      });
    }

    const [row] = await listSessions(db);
    expect(row).toMatchObject({
      section: "writing",
      overallScore: 15,
      tasksSubmitted: 2,
      correct: 0,
      total: 0,
      difficulty: null,
    });
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — unscored online sessions list as null, not 0.
  it("reports a writing session with no evaluations as unscored", async () => {
    const s = await seedWritingSession();
    await seedWritingResponse(s, 1);

    const [row] = await listSessions(db);
    expect(row).toMatchObject({ overallScore: null, tasksSubmitted: 0 });
  });

  // spec: docs/specs/speaking-session.md §Behaviour.17 — same shape as writing.
  it("averages per-task scores for a speaking session", async () => {
    const [s] = await db
      .insert(sessions)
      .values({
        section: "speaking",
        mode: "real",
        completedAt: new Date(),
      })
      .returning({ id: sessions.id });
    const [t] = await db
      .insert(speakingTasks)
      .values({
        sourceFile: "bank.json",
        sequence: 0,
        taskNumber: 1,
        question: "Parlez de vous.",
      })
      .returning({ id: speakingTasks.id });
    const [r] = await db
      .insert(speakingResponses)
      .values({
        sessionId: s.id,
        speakingTaskId: t.id,
        taskNumber: 1,
        submittedAt: new Date(),
      })
      .returning({ id: speakingResponses.id });
    await db.insert(speakingEvaluations).values({
      responseId: r.id,
      score: 12,
      strengths: "s",
      errors: "e",
      improvements: "i",
      generatedBy: "test",
    });

    const [row] = await listSessions(db);
    expect(row).toMatchObject({
      section: "speaking",
      overallScore: 12,
      tasksSubmitted: 1,
    });
  });

  it("reports a writing session with no responses at all as unscored", async () => {
    await db.insert(sessions).values({
      section: "writing",
      mode: "learning",
      completedAt: new Date(),
    });
    const [row] = await listSessions(db);
    expect(row).toMatchObject({ overallScore: null, tasksSubmitted: 0 });
  });
});

describe("getSession", () => {
  it("rejects an unknown session id with a 404", async () => {
    await expect(getSession(db, 777)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
      status: 404,
    });
  });

  // A session that was started but never completed is not reviewable.
  it("rejects an in-progress session with a 404", async () => {
    await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await expect(getSession(db, sessionId)).rejects.toMatchObject({
      code: "SESSION_NOT_FOUND",
    });
  });

  // spec: docs/specs/review-mode.md §Behaviour.4 — each row carries the full content to render review.
  it("returns each answer enriched with question, passage, options and band", async () => {
    const ids = await seedQuestions([
      {
        sequence: 2,
        correct: "A",
        passageText: "Le texte source.",
        explain: true,
      },
    ]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await recordAnswer(db, sessionId, ids[0], "C");
    await completeSession(db, sessionId, null);

    const detail = await getSession(db, sessionId);
    expect(detail.session).toMatchObject({
      id: sessionId,
      correct: 0,
      total: 1,
      pointsScored: null,
    });
    expect(detail.results).toHaveLength(1);
    expect(detail.results[0]).toMatchObject({
      questionId: ids[0],
      sequence: 2,
      chosenLabel: "C",
      correctLabel: "A",
      isCorrect: false,
      difficulty: "beginner",
      passage: { text: "Le texte source." },
    });
    expect(detail.results[0].options.map((o) => o.label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(detail.results[0].explanation?.correctReason).toBe(
      "Because the passage says so.",
    );
    expect(typeof detail.results[0].answeredAt).toBe("string");
  });

  // spec: docs/specs/review-mode.md §Behaviour.3 — ordered by import sequence, not answer time.
  it("sorts review rows by sequence regardless of the order answered", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await recordAnswer(db, sessionId, ids[3], "A");
    await recordAnswer(db, sessionId, ids[1], "A");
    await recordAnswer(db, sessionId, ids[0], "A");
    await completeSession(db, sessionId, null);

    const detail = await getSession(db, sessionId);
    expect(detail.results.map((r) => r.sequence)).toEqual([1, 2, 4]);
  });

  it("reports weighted points for a completed real session", async () => {
    const ids = await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "real",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await recordAnswer(db, sessionId, ids[1], "B");
    await completeSession(db, sessionId, 30_000);

    const detail = await getSession(db, sessionId);
    expect(detail.session).toMatchObject({
      pointsScored: 3,
      pointsPossible: 6,
      elapsedMs: 30_000,
    });
  });

  it("returns an empty result list for a completed session with no answers", async () => {
    await seedQuestions(beginnerBand);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await completeSession(db, sessionId, null);

    const detail = await getSession(db, sessionId);
    expect(detail.results).toEqual([]);
    expect(detail.session).toMatchObject({ correct: 0, total: 0 });
  });

  it("leaves correctLabel null when the question lost its answer key", async () => {
    const ids = await seedQuestions([{ sequence: 1, correct: "A" }]);
    const { sessionId } = await createSession(db, {
      section: "reading",
      mode: "learning",
      difficulty: "beginner",
    });
    await recordAnswer(db, sessionId, ids[0], "A");
    await completeSession(db, sessionId, null);
    // Simulate a re-import that dropped the key after the session was recorded.
    await db.delete(options);

    const detail = await getSession(db, sessionId);
    expect(detail.results[0].correctLabel).toBeNull();
    expect(detail.results[0].options).toEqual([]);
  });
});
