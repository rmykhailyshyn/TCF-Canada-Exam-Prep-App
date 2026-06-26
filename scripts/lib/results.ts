import { pointsForSequence } from "../../server/lib/bands";

// spec: docs/specs/reading-import.md §PDF structure + §Behaviour
// Pure helpers over the JSON emitted by scripts/parse_results_pdf.py. Kept free of I/O and DB
// access so the answer-key and score cross-check logic is unit-testable.

export type OptionColor = "green" | "red" | "gray" | null;

export type ParsedOption = {
  label: "A" | "B" | "C" | "D";
  text: string;
  color: OptionColor;
};

export type ParsedQuestion = {
  sequence: number;
  text: string;
  options: ParsedOption[];
  result: "Correcte" | "Incorrecte" | null;
};

export type ScoreSummary = {
  correctCount: number;
  totalPoints: number;
  maxPoints: number;
  time: string | null;
};

export type ParsedResults = {
  scoreSummary: ScoreSummary;
  questions: ParsedQuestion[];
};

// spec: docs/specs/reading-import.md §Behaviour.10 — exactly one green option is the answer.
export function resolveCorrectLabel(
  question: ParsedQuestion,
): { ok: true; label: "A" | "B" | "C" | "D" } | { ok: false; reason: string } {
  const greens = question.options.filter((o) => o.color === "green");
  if (greens.length === 1) {
    return { ok: true, label: greens[0].label };
  }
  return {
    ok: false,
    reason:
      greens.length === 0
        ? `Question ${question.sequence} has no green (correct) option`
        : `Question ${question.sequence} has ${greens.length} green options (${greens
            .map((g) => g.label)
            .join(", ")})`,
  };
}

export type ScoreCrossCheck = {
  recomputedCorrect: number;
  recomputedPoints: number;
  pdfCorrect: number;
  pdfPoints: number;
  matches: boolean;
};

// spec: docs/specs/reading-import.md §Behaviour.7 — recompute the weighted score from the
// imported answer key against the PDF's Correcte/Incorrecte labels and compare to "<P> of 699".
export function crossCheckScore(results: ParsedResults): ScoreCrossCheck {
  let recomputedCorrect = 0;
  let recomputedPoints = 0;
  for (const q of results.questions) {
    if (q.result === "Correcte") {
      recomputedCorrect += 1;
      const resolved = resolveCorrectLabel(q);
      if (resolved.ok) {
        recomputedPoints += pointsForSequence(q.sequence);
      }
    }
  }
  return {
    recomputedCorrect,
    recomputedPoints,
    pdfCorrect: results.scoreSummary.correctCount,
    pdfPoints: results.scoreSummary.totalPoints,
    matches:
      recomputedCorrect === results.scoreSummary.correctCount &&
      recomputedPoints === results.scoreSummary.totalPoints,
  };
}

// spec: docs/specs/reading-import.md §Behaviour.5 — match a passage image to a question by the
// sequence number embedded in its filename (e.g. `comprehension-ecrite-25Q39.png` → 39). Prefer
// the number after a `Q`; otherwise fall back to the last number in the name.
export function extractSequenceFromFilename(filename: string): number | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const afterQ = base.match(/[Qq](\d+)/);
  if (afterQ) return Number.parseInt(afterQ[1], 10);
  const numbers = base.match(/\d+/g);
  if (numbers && numbers.length > 0)
    return Number.parseInt(numbers[numbers.length - 1], 10);
  return null;
}

// Verifies a file's leading bytes are a PNG or JPEG signature. Guards against "images" that are
// actually HTML/text saved with an image extension (a real export hazard) — they would otherwise
// fail deep inside Tesseract with a cryptic leptonica error.
export function hasImageMagic(header: Uint8Array): boolean {
  const isPng =
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47;
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  return isPng || isJpeg;
}

// spec: docs/specs/reading-import.md §Behaviour.5 — the per-question image holds the passage,
// then the `www.reussir-tcfcanada.com` footer, then the question text (prefixed by the badge
// number). Split OCR output at the footer; strip the leading badge number from the question.
export function splitStimulus(ocrText: string): {
  passage: string;
  question: string;
} {
  const lines = ocrText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const footerIdx = lines.findIndex((l) =>
    l.toLowerCase().replace(/\s+/g, "").includes("reussir-tcfcanada"),
  );

  const passageLines =
    footerIdx === -1 ? lines.slice(0, -1) : lines.slice(0, footerIdx);
  const questionLines =
    footerIdx === -1 ? lines.slice(-1) : lines.slice(footerIdx + 1);

  const question = questionLines
    .join(" ")
    .replace(/^[^\p{L}]*\d+[^\p{L}]*/u, "") // drop the leading badge number, e.g. "39 "
    .trim();

  return { passage: passageLines.join("\n").trim(), question };
}
