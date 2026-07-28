import { describe, expect, it } from "vitest";
import { ApiError } from "./errors";
import {
  type ExportQuestion,
  deriveDifficulty,
  parseDifficultyFilter,
  parseSectionFilter,
  sequenceMatchesDifficulty,
  validateDocument,
  validateQuestion,
} from "./export-import";

// spec: docs/specs/question-export-import.md §Validation + §API contract
// Pure rules — exercised without a database (the service owns reads/writes).

function readingQuestion(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    section: "reading",
    sourceFile: "/abs/results.pdf",
    sequence: 12,
    text: "Question prompt",
    options: [
      { label: "A", text: "a", isCorrect: false },
      { label: "B", text: "b", isCorrect: true },
      { label: "C", text: "c", isCorrect: false },
      { label: "D", text: "d", isCorrect: false },
    ],
    passage: { sourceFile: "/abs/25Q12.png", text: "passage" },
    ...overrides,
  };
}

function listeningQuestion(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    section: "listening",
    sourceFile: "/abs/results.pdf",
    sequence: 5,
    text: "Listen and answer",
    options: [
      { label: "A", text: "a", isCorrect: true },
      { label: "B", text: "b", isCorrect: false },
      { label: "C", text: "c", isCorrect: false },
      { label: "D", text: "d", isCorrect: false },
    ],
    audio: { fileName: "q05.mp3", durationMs: 30000 },
    transcript: [{ sequence: 0, text: "bonjour", startMs: 0, endMs: 1200 }],
    ...overrides,
  };
}

describe("parseSectionFilter", () => {
  it("defaults to all and accepts the three valid values", () => {
    expect(parseSectionFilter(undefined)).toBe("all");
    expect(parseSectionFilter("reading")).toBe("reading");
    expect(parseSectionFilter("listening")).toBe("listening");
    expect(parseSectionFilter("all")).toBe("all");
  });

  it("throws INVALID_SECTION on anything else", () => {
    expect(() => parseSectionFilter("both")).toThrow(ApiError);
    try {
      parseSectionFilter("both");
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_SECTION");
    }
  });
});

describe("parseDifficultyFilter", () => {
  it("defaults to all and treats empty as all", () => {
    expect(parseDifficultyFilter(undefined)).toBe("all");
    expect(parseDifficultyFilter("all")).toBe("all");
    expect(parseDifficultyFilter("")).toBe("all");
  });

  it("parses a comma-separated subset of band slugs (trimming whitespace)", () => {
    expect(parseDifficultyFilter("intermediate, advanced")).toEqual([
      "intermediate",
      "advanced",
    ]);
  });

  it("throws INVALID_DIFFICULTY on an unknown slug", () => {
    try {
      parseDifficultyFilter("intermediate,bogus");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("INVALID_DIFFICULTY");
    }
  });
});

describe("deriveDifficulty / sequenceMatchesDifficulty", () => {
  it("maps a sequence onto its band slug", () => {
    expect(deriveDifficulty(1)).toBe("beginner");
    expect(deriveDifficulty(12)).toBe("intermediate");
    expect(deriveDifficulty(39)).toBe("expert");
  });

  it('matches everything for "all", and only the listed bands otherwise', () => {
    expect(sequenceMatchesDifficulty(12, "all")).toBe(true);
    expect(sequenceMatchesDifficulty(12, ["intermediate"])).toBe(true);
    expect(sequenceMatchesDifficulty(12, ["advanced"])).toBe(false);
  });
});

describe("validateDocument (structure)", () => {
  it("rejects a missing/unsupported formatVersion", () => {
    expect(() => validateDocument({ questions: [] })).toThrow(
      /INVALID_FORMAT|formatVersion/,
    );
    try {
      validateDocument({ formatVersion: 99, questions: [] });
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_FORMAT");
    }
  });

  it("rejects a non-array questions field", () => {
    try {
      validateDocument({ formatVersion: 1, questions: "nope" });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_FORMAT");
    }
  });

  it("accepts a well-formed document and normalises difficulty from sequence", () => {
    const out = validateDocument({
      formatVersion: 1,
      questions: [readingQuestion(), listeningQuestion()],
    });
    expect(out).toHaveLength(2);
    expect(out[0].difficulty).toBe("intermediate");
    expect(out[1].difficulty).toBe("elementary");
  });
});

describe("validateQuestion (shape + answer key)", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["bad section", readingQuestion({ section: "speaking" }), "section"],
    ["empty sourceFile", readingQuestion({ sourceFile: "  " }), "sourceFile"],
    ["sequence out of range", readingQuestion({ sequence: 40 }), "sequence"],
    ["empty text", readingQuestion({ text: "" }), "text"],
    [
      "three options",
      readingQuestion({
        options: [
          { label: "A", text: "a", isCorrect: true },
          { label: "B", text: "b", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
        ],
      }),
      "options",
    ],
    [
      "no correct option",
      readingQuestion({
        options: [
          { label: "A", text: "a", isCorrect: false },
          { label: "B", text: "b", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "isCorrect",
    ],
    [
      "two correct options",
      readingQuestion({
        options: [
          { label: "A", text: "a", isCorrect: true },
          { label: "B", text: "b", isCorrect: true },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "isCorrect",
    ],
    [
      "listening without audio",
      listeningQuestion({ audio: undefined }),
      "audio",
    ],
    [
      "listening without transcript",
      listeningQuestion({ transcript: undefined }),
      "transcript",
    ],
  ];

  for (const [name, q, key] of cases) {
    it(`rejects: ${name}`, () => {
      try {
        validateQuestion(q);
        throw new Error("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).code).toBe("VALIDATION_FAILED");
        expect((e as ApiError).message).toContain(key);
      }
    });
  }

  it("accepts a valid reading question and a valid listening question", () => {
    const r: ExportQuestion = validateQuestion(readingQuestion());
    expect(r.passage).toEqual({
      sourceFile: "/abs/25Q12.png",
      text: "passage",
    });
    expect(r.audio).toBeNull();

    const l: ExportQuestion = validateQuestion(listeningQuestion());
    expect(l.audio).toEqual({ fileName: "q05.mp3", durationMs: 30000 });
    expect(l.transcript).toHaveLength(1);
    expect(l.passage).toBeNull();
  });

  it("allows a reading question with a null passage", () => {
    const r = validateQuestion(readingQuestion({ passage: null }));
    expect(r.passage).toBeNull();
  });

  it("allows a listening question with an empty transcript", () => {
    const l = validateQuestion(listeningQuestion({ transcript: [] }));
    expect(l.transcript).toEqual([]);
  });

  // The remaining per-field rejections, each naming the offending key so the operator can find it.
  const moreCases: [string, unknown, string][] = [
    ["a non-object question", "not an object", "object"],
    ["a null question", null, "object"],
    [
      "an option that is not an object",
      readingQuestion({
        options: ["A", "B", "C", "D"],
      }),
      "option",
    ],
    [
      "an option label outside A–D",
      readingQuestion({
        options: [
          { label: "E", text: "e", isCorrect: true },
          { label: "B", text: "b", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "label",
    ],
    [
      "a duplicate option label",
      readingQuestion({
        options: [
          { label: "A", text: "a", isCorrect: true },
          { label: "A", text: "a2", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "Duplicate option label",
    ],
    [
      "an option with a non-string text",
      readingQuestion({
        options: [
          { label: "A", text: 1, isCorrect: true },
          { label: "B", text: "b", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "text",
    ],
    [
      "an option with a non-boolean isCorrect",
      readingQuestion({
        options: [
          { label: "A", text: "a", isCorrect: "yes" },
          { label: "B", text: "b", isCorrect: false },
          { label: "C", text: "c", isCorrect: false },
          { label: "D", text: "d", isCorrect: false },
        ],
      }),
      "isCorrect",
    ],
    ["a non-integer sequence", readingQuestion({ sequence: 1.5 }), "sequence"],
    ["a sequence below 1", readingQuestion({ sequence: 0 }), "sequence"],
    ["a non-numeric sequence", readingQuestion({ sequence: "3" }), "sequence"],
    [
      "a passage that is neither an object nor null",
      readingQuestion({ passage: "just text" }),
      "passage",
    ],
    [
      "a passage with an empty sourceFile",
      readingQuestion({ passage: { sourceFile: " ", text: "t" } }),
      "sourceFile",
    ],
    [
      "a passage with a non-string text",
      readingQuestion({ passage: { sourceFile: "p.png", text: 7 } }),
      "text",
    ],
    [
      "a transcript segment that is not an object",
      listeningQuestion({ transcript: ["bonjour"] }),
      "segment",
    ],
    [
      "a transcript segment with no numeric sequence",
      listeningQuestion({
        transcript: [{ text: "a", startMs: 0, endMs: 1 }],
      }),
      "sequence",
    ],
    [
      "a transcript segment with a non-string text",
      listeningQuestion({
        transcript: [{ sequence: 0, text: 5, startMs: 0, endMs: 1 }],
      }),
      "text",
    ],
    [
      "a transcript segment with a non-numeric startMs",
      listeningQuestion({
        transcript: [{ sequence: 0, text: "a", startMs: "0", endMs: 1 }],
      }),
      "startMs",
    ],
    [
      "a transcript segment with a non-numeric endMs",
      listeningQuestion({
        transcript: [{ sequence: 0, text: "a", startMs: 0, endMs: null }],
      }),
      "endMs",
    ],
    [
      "an audio reference with an empty fileName",
      listeningQuestion({ audio: { fileName: "  ", durationMs: 1 } }),
      "fileName",
    ],
    [
      "an audio durationMs that is neither a number nor null",
      listeningQuestion({ audio: { fileName: "q.mp3", durationMs: "30s" } }),
      "durationMs",
    ],
  ];

  for (const [name, q, key] of moreCases) {
    it(`rejects ${name}`, () => {
      expect(() => validateQuestion(q)).toThrow(ApiError);
      try {
        validateQuestion(q);
      } catch (e) {
        expect((e as ApiError).code).toBe("VALIDATION_FAILED");
        expect((e as ApiError).message).toContain(key);
      }
    });
  }

  // spec: §Behaviour.14 — the message labels the question so a bad element can be located.
  it("labels the offending question in the error message", () => {
    try {
      validateQuestion(readingQuestion({ text: "" }));
    } catch (e) {
      expect((e as ApiError).message).toContain("reading/12");
    }
    try {
      validateQuestion("nonsense");
    } catch (e) {
      expect((e as ApiError).message).toContain("?/?");
    }
  });

  it("trims the sourceFile and the passage sourceFile", () => {
    const r = validateQuestion(
      readingQuestion({
        sourceFile: "  results.pdf  ",
        passage: { sourceFile: "  p.png  ", text: "t" },
      }),
    );
    expect(r.sourceFile).toBe("results.pdf");
    expect(r.passage?.sourceFile).toBe("p.png");
  });

  it("normalises a missing audio durationMs to null", () => {
    const l = validateQuestion(
      listeningQuestion({ audio: { fileName: "q.mp3", durationMs: null } }),
    );
    expect(l.audio?.durationMs).toBeNull();
  });

  it("accepts an absent (undefined) reading passage", () => {
    expect(validateQuestion(readingQuestion({ passage: undefined })).passage)
      .toBeNull();
  });
});

describe("assertDocumentShape (via validateDocument)", () => {
  it("rejects a document that is not an object", () => {
    for (const bad of ["a string", 42, null, ["array"]]) {
      expect(() => validateDocument(bad)).toThrow(ApiError);
    }
  });

  it("names the unsupported formatVersion in the message", () => {
    try {
      validateDocument({ formatVersion: 99, questions: [] });
    } catch (e) {
      expect((e as ApiError).code).toBe("INVALID_FORMAT");
      expect((e as ApiError).message).toContain("99");
    }
  });

  it("accepts an empty question list", () => {
    expect(validateDocument({ formatVersion: 1, questions: [] })).toEqual([]);
  });
});
