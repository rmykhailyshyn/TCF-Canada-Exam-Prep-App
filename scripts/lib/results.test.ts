import { describe, expect, it } from "vitest";
import {
  type ParsedQuestion,
  type ParsedResults,
  crossCheckScore,
  extractSequenceFromFilename,
  hasImageMagic,
  resolveCorrectLabel,
  splitStimulus,
} from "./results";

// Builds a question with exactly one green option at `greenLabel`.
function question(
  sequence: number,
  greenLabel: "A" | "B" | "C" | "D",
  result: "Correcte" | "Incorrecte",
): ParsedQuestion {
  const labels: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
  return {
    sequence,
    text: `Question ${sequence}`,
    result,
    options: labels.map((label) => ({
      label,
      text: label,
      color: label === greenLabel ? "green" : "gray",
    })),
  };
}

describe("resolveCorrectLabel", () => {
  // spec: docs/specs/reading-import.md §Behaviour.10
  it("returns the single green option label", () => {
    const r = resolveCorrectLabel(question(1, "C", "Correcte"));
    expect(r).toEqual({ ok: true, label: "C" });
  });

  it("fails when no option is green", () => {
    const q: ParsedQuestion = {
      sequence: 5,
      text: "x",
      result: "Incorrecte",
      options: [
        { label: "A", text: "a", color: "gray" },
        { label: "B", text: "b", color: "red" },
        { label: "C", text: "c", color: "gray" },
        { label: "D", text: "d", color: "gray" },
      ],
    };
    const r = resolveCorrectLabel(q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no green");
  });

  it("fails when more than one option is green", () => {
    const q: ParsedQuestion = {
      sequence: 9,
      text: "x",
      result: "Correcte",
      options: [
        { label: "A", text: "a", color: "green" },
        { label: "B", text: "b", color: "green" },
        { label: "C", text: "c", color: "gray" },
        { label: "D", text: "d", color: "gray" },
      ],
    };
    const r = resolveCorrectLabel(q);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("2 green");
  });
});

describe("crossCheckScore", () => {
  // spec: docs/specs/reading-import.md §Behaviour.7 — recomputed vs PDF "<P> of 699"
  it("matches when recomputed correct/points equal the PDF summary", () => {
    const results: ParsedResults = {
      scoreSummary: {
        correctCount: 2,
        totalPoints: 12,
        maxPoints: 699,
        time: "00:10:00",
      },
      // seq 1 (3 pts) + seq 5 (9 pts) correct = 12 pts; seq 11 incorrect.
      questions: [
        question(1, "A", "Correcte"),
        question(5, "B", "Correcte"),
        question(11, "C", "Incorrecte"),
      ],
    };
    const check = crossCheckScore(results);
    expect(check).toMatchObject({
      recomputedCorrect: 2,
      recomputedPoints: 12,
      matches: true,
    });
  });

  it("flags a mismatch when the recomputed score differs", () => {
    const results: ParsedResults = {
      scoreSummary: {
        correctCount: 2,
        totalPoints: 999,
        maxPoints: 699,
        time: null,
      },
      questions: [question(1, "A", "Correcte"), question(5, "B", "Correcte")],
    };
    const check = crossCheckScore(results);
    expect(check.recomputedPoints).toBe(12);
    expect(check.matches).toBe(false);
  });
});

describe("extractSequenceFromFilename", () => {
  // spec: docs/specs/reading-import.md §Behaviour.5 — sequence number embedded in the filename
  it("reads the number after Q, ignoring a leading test number", () => {
    expect(extractSequenceFromFilename("comprehension-ecrite-25Q39.png")).toBe(
      39,
    );
    expect(extractSequenceFromFilename("25Q2.png")).toBe(2);
    expect(extractSequenceFromFilename("20Q18.png")).toBe(18);
  });

  it("falls back to the last number when there is no Q", () => {
    expect(extractSequenceFromFilename("passage-07.jpg")).toBe(7);
    expect(extractSequenceFromFilename("q1.PNG")).toBe(1);
  });

  it("returns null when the filename has no number", () => {
    expect(extractSequenceFromFilename("passage.png")).toBeNull();
  });
});

describe("splitStimulus", () => {
  // spec: docs/specs/reading-import.md §Behaviour.5 — passage / footer / question
  it("splits passage and question at the footer and strips the badge number", () => {
    const ocr = [
      "Le tourisme en France a longtemps été perçu comme un filon.",
      "Cela pourrait devenir un danger.",
      "WwWw.reussir-tcfcanada.com",
      "39 Qu'apprend-on au sujet du « surtourisme » ?",
    ].join("\n");
    const { passage, question } = splitStimulus(ocr);
    expect(passage).toContain("Le tourisme en France");
    expect(passage).not.toContain("reussir-tcfcanada");
    expect(question).toBe("Qu'apprend-on au sujet du « surtourisme » ?");
  });

  it("falls back to the last line as the question when no footer is present", () => {
    const { passage, question } = splitStimulus(
      "Un passage court.\nQue dit le texte ?",
    );
    expect(passage).toBe("Un passage court.");
    expect(question).toBe("Que dit le texte ?");
  });
});

describe("hasImageMagic", () => {
  it("accepts PNG and JPEG signatures", () => {
    expect(
      hasImageMagic(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe(true);
    expect(hasImageMagic(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
  });

  it("rejects HTML/text masquerading as an image", () => {
    // "<!DOCTYPE" — an HTML page saved with a .png extension (a real export hazard).
    expect(
      hasImageMagic(
        Uint8Array.from([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50]),
      ),
    ).toBe(false);
  });
});
