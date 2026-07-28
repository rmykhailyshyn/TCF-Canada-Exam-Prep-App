import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  audioFiles,
  options,
  passages,
  questions,
  transcriptSegments,
} from "../db/schema";
import { FORMAT_VERSION } from "../lib/export-import";
import type { ExportDocument, ExportQuestion } from "../lib/export-import";
import { type TestDb, cleanupDbs, freshDb } from "../test-support/db";
import { type FakeMediaStore, fakeMediaStore } from "../test-support/fakes";
import { exportQuestions, importQuestions } from "./export-import";

// spec: docs/specs/question-export-import.md §API contract; §Behaviour.3, 10, 11, 14
// DB-backed coverage for Question Bank export/import. Import runs inside a single Drizzle
// transaction, so these drive the real temp-file SQLite database (a literal :memory: URL would lose
// the schema on the driver's post-transaction reconnect — see server/test-support/db.ts).

let db: TestDb;
let media: FakeMediaStore;

beforeEach(async () => {
  db = await freshDb();
  media = fakeMediaStore();
});

afterEach(() => {
  cleanupDbs();
});

const OPTS = (correct: "A" | "B" | "C" | "D") =>
  (["A", "B", "C", "D"] as const).map((label) => ({
    label,
    text: `Option ${label}`,
    isCorrect: label === correct,
  }));

function readingQuestion(
  overrides: Partial<ExportQuestion> = {},
): ExportQuestion {
  return {
    section: "reading",
    sourceFile: "reading.pdf",
    sequence: 1,
    difficulty: "beginner",
    text: "Quel est le sujet ?",
    options: OPTS("A"),
    passage: { sourceFile: "passage-1.txt", text: "Le texte." },
    audio: null,
    transcript: [],
    ...overrides,
  };
}

function listeningQuestion(
  overrides: Partial<ExportQuestion> = {},
): ExportQuestion {
  return {
    section: "listening",
    sourceFile: "listening.pdf",
    sequence: 5,
    difficulty: "elementary",
    text: "Qu'entendez-vous ?",
    options: OPTS("B"),
    passage: null,
    audio: { fileName: "q5.mp3", durationMs: 4200 },
    transcript: [
      { sequence: 0, text: "Bonjour.", startMs: 0, endMs: 1000 },
      { sequence: 1, text: "Au revoir.", startMs: 1000, endMs: 2000 },
    ],
    ...overrides,
  };
}

function doc(...qs: ExportQuestion[]): ExportDocument {
  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    filter: { section: "all", difficulties: "all" },
    questions: qs,
  };
}

describe("importQuestions", () => {
  // spec: §Behaviour.13 — the envelope is checked before any write.
  it("rejects a document with an unsupported format version", async () => {
    await expect(
      importQuestions(db, media, { ...doc(), formatVersion: 99 }, false),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
    expect(await db.select().from(questions)).toEqual([]);
  });

  it("rejects a document that is not an object", async () => {
    await expect(
      importQuestions(db, media, "nope", false),
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  // spec: §Behaviour.14 — per-question validation names the offending question.
  it("rejects an invalid question and writes nothing", async () => {
    const bad = readingQuestion({ text: "" });
    await expect(
      importQuestions(db, media, doc(bad), false),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(await db.select().from(questions)).toEqual([]);
  });

  it("inserts a reading question with its passage and options", async () => {
    const summary = await importQuestions(
      db,
      media,
      doc(readingQuestion()),
      false,
    );
    expect(summary).toMatchObject({
      inserted: 1,
      overridden: 0,
      skipped: 0,
      total: 1,
      warnings: [],
    });

    const [q] = await db.select().from(questions);
    expect(q).toMatchObject({ sequence: 1, section: "reading" });
    const [p] = await db.select().from(passages);
    expect(p).toMatchObject({ sourceFile: "passage-1.txt", text: "Le texte." });
    expect(q.passageId).toBe(p.id);
    expect(await db.select().from(options)).toHaveLength(4);
  });

  it("inserts a reading question that carries no passage", async () => {
    await importQuestions(
      db,
      media,
      doc(readingQuestion({ passage: null })),
      false,
    );
    const [q] = await db.select().from(questions);
    expect(q.passageId).toBeNull();
    expect(await db.select().from(passages)).toEqual([]);
  });

  // spec: §Behaviour.9 — an existing (source_file, sequence) is skipped unless override is set.
  it("skips an existing question when override is off", async () => {
    await importQuestions(db, media, doc(readingQuestion()), false);
    const summary = await importQuestions(
      db,
      media,
      doc(readingQuestion({ text: "Nouveau texte" })),
      false,
    );
    expect(summary).toMatchObject({ inserted: 0, skipped: 1, overridden: 0 });
    const [q] = await db.select().from(questions);
    expect(q.text).toBe("Quel est le sujet ?");
  });

  // spec: §Behaviour.10 — override rewrites in place, keeping questions.id (and its results) stable.
  it("overrides in place, keeping the question id and replacing the options", async () => {
    await importQuestions(db, media, doc(readingQuestion()), false);
    const [before] = await db.select().from(questions);

    const summary = await importQuestions(
      db,
      media,
      doc(
        readingQuestion({
          text: "Texte révisé",
          options: OPTS("D"),
          passage: { sourceFile: "passage-1.txt", text: "Texte révisé." },
        }),
      ),
      true,
    );
    expect(summary).toMatchObject({ inserted: 0, overridden: 1, skipped: 0 });

    const [after] = await db.select().from(questions);
    expect(after.id).toBe(before.id);
    expect(after.text).toBe("Texte révisé");
    const opts = await db.select().from(options);
    expect(opts).toHaveLength(4);
    expect(opts.find((o) => o.isCorrect)?.label).toBe("D");
    // The passage row is reused (unique source_file) and its text updated in place.
    const passageRows = await db.select().from(passages);
    expect(passageRows).toHaveLength(1);
    expect(passageRows[0].text).toBe("Texte révisé.");
  });

  it("inserts a listening question with its transcript and audio reference", async () => {
    await media.put("listening/q5.mp3", new Uint8Array([1, 2, 3]), "audio/mpeg");
    const summary = await importQuestions(
      db,
      media,
      doc(listeningQuestion()),
      false,
    );
    expect(summary.warnings).toEqual([]);

    const [audio] = await db.select().from(audioFiles);
    expect(audio).toMatchObject({
      filePath: "listening/q5.mp3",
      durationMs: 4200,
    });
    expect(await db.select().from(transcriptSegments)).toHaveLength(2);
  });

  // The reference imports either way; the missing MP3 is reported as a warning, not a failure.
  it("warns when the referenced audio is absent from the media store", async () => {
    const summary = await importQuestions(
      db,
      media,
      doc(listeningQuestion()),
      false,
    );
    expect(summary.inserted).toBe(1);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("listening/q5.mp3");
    expect(await db.select().from(audioFiles)).toHaveLength(1);
  });

  it("accepts a listening question with an empty transcript", async () => {
    await importQuestions(
      db,
      media,
      doc(listeningQuestion({ transcript: [] })),
      false,
    );
    expect(await db.select().from(transcriptSegments)).toEqual([]);
    expect(await db.select().from(audioFiles)).toHaveLength(1);
  });

  it("updates the audio row in place on override rather than duplicating it", async () => {
    await importQuestions(db, media, doc(listeningQuestion()), false);
    await importQuestions(
      db,
      media,
      doc(
        listeningQuestion({
          audio: { fileName: "q5-v2.mp3", durationMs: 5000 },
          transcript: [{ sequence: 0, text: "Salut.", startMs: 0, endMs: 500 }],
        }),
      ),
      true,
    );
    const rows = await db.select().from(audioFiles);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filePath: "listening/q5-v2.mp3",
      durationMs: 5000,
    });
    expect(await db.select().from(transcriptSegments)).toHaveLength(1);
  });

  // A listening question re-imported as reading must not leave its audio/transcript rows behind.
  it("clears stale listening rows when a question is overridden as reading", async () => {
    await importQuestions(db, media, doc(listeningQuestion()), false);
    await importQuestions(
      db,
      media,
      doc(
        readingQuestion({
          sourceFile: "listening.pdf",
          sequence: 5,
          difficulty: "elementary",
          passage: null,
        }),
      ),
      true,
    );
    expect(await db.select().from(audioFiles)).toEqual([]);
    expect(await db.select().from(transcriptSegments)).toEqual([]);
  });

  it("imports several questions in one document", async () => {
    const summary = await importQuestions(
      db,
      media,
      doc(
        readingQuestion(),
        readingQuestion({ sequence: 2, sourceFile: "reading.pdf" }),
        listeningQuestion(),
      ),
      false,
    );
    expect(summary).toMatchObject({ inserted: 3, total: 3 });
    expect(await db.select().from(questions)).toHaveLength(3);
  });

  it("counts a mix of inserts and skips in one run", async () => {
    await importQuestions(db, media, doc(readingQuestion()), false);
    const summary = await importQuestions(
      db,
      media,
      doc(readingQuestion(), readingQuestion({ sequence: 2 })),
      false,
    );
    expect(summary).toMatchObject({ inserted: 1, skipped: 1, total: 2 });
  });
});

describe("exportQuestions", () => {
  async function seedBoth(): Promise<void> {
    await importQuestions(
      db,
      media,
      doc(
        readingQuestion(),
        readingQuestion({ sequence: 11, difficulty: "intermediate" }),
        listeningQuestion(),
      ),
      false,
    );
  }

  it("returns an empty question list when nothing matches", async () => {
    const out = await exportQuestions(db, "all", "all");
    expect(out.questions).toEqual([]);
    expect(out.formatVersion).toBe(FORMAT_VERSION);
    expect(out.filter).toEqual({ section: "all", difficulties: "all" });
    expect(typeof out.exportedAt).toBe("string");
  });

  it("exports every section ordered by section then sequence", async () => {
    await seedBoth();
    const out = await exportQuestions(db, "all", "all");
    expect(out.questions.map((q) => [q.section, q.sequence])).toEqual([
      ["listening", 5],
      ["reading", 1],
      ["reading", 11],
    ]);
  });

  it("narrows to a single section", async () => {
    await seedBoth();
    const out = await exportQuestions(db, "reading", "all");
    expect(out.questions.map((q) => q.sequence)).toEqual([1, 11]);
  });

  // spec: §Behaviour.3 — complexity is derived from sequence and filtered in memory.
  it("filters by derived difficulty band", async () => {
    await seedBoth();
    const out = await exportQuestions(db, "all", ["intermediate"]);
    expect(out.questions.map((q) => q.sequence)).toEqual([11]);
    expect(out.questions[0].difficulty).toBe("intermediate");
  });

  it("round-trips a reading question with its passage and sorted options", async () => {
    await seedBoth();
    const out = await exportQuestions(db, "reading", ["beginner"]);
    expect(out.questions[0]).toMatchObject({
      section: "reading",
      sourceFile: "reading.pdf",
      sequence: 1,
      passage: { sourceFile: "passage-1.txt", text: "Le texte." },
      audio: null,
      transcript: [],
    });
    expect(out.questions[0].options.map((o) => o.label)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(out.questions[0].options.find((o) => o.isCorrect)?.label).toBe("A");
  });

  // The stored path is relative to MEDIA_DIR; the export carries the basename only.
  it("round-trips a listening question as a basename plus ordered transcript", async () => {
    await seedBoth();
    const out = await exportQuestions(db, "listening", "all");
    expect(out.questions[0]).toMatchObject({
      audio: { fileName: "q5.mp3", durationMs: 4200 },
      passage: null,
    });
    expect(out.questions[0].transcript.map((s) => s.sequence)).toEqual([0, 1]);
  });

  it("survives a document re-import unchanged (export → import → export)", async () => {
    await seedBoth();
    const first = await exportQuestions(db, "all", "all");
    await importQuestions(db, media, first, true);
    const second = await exportQuestions(db, "all", "all");
    expect(second.questions).toEqual(first.questions);
  });
});
