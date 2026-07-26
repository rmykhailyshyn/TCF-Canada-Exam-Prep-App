import { ApiError } from "./errors";
import { BANDS, type DifficultySlug, bandForSequence } from "./bands";

// spec: docs/specs/question-export-import.md
// Pure (DB-free) core for the Question Bank export/import feature: the document shape, filter
// parsing, and structural + answer-key validation. Keeping this side-effect-free lets the rules
// be unit-tested without a database; the service layer owns all reads/writes.

export const FORMAT_VERSION = 1;

export type SectionFilter = "reading" | "listening" | "all";
export type DifficultyFilter = DifficultySlug[] | "all";

export type ExportOption = {
  label: "A" | "B" | "C" | "D";
  text: string;
  isCorrect: boolean;
};

export type ExportPassage = { sourceFile: string; text: string };
export type ExportAudio = { fileName: string; durationMs: number | null };
export type ExportTranscriptSegment = {
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
};

export type ExportQuestion = {
  section: "reading" | "listening";
  sourceFile: string;
  sequence: number;
  // Derived from `sequence` on export; informational only (recomputed on import).
  difficulty: DifficultySlug | null;
  text: string;
  options: ExportOption[];
  passage: ExportPassage | null;
  audio: ExportAudio | null;
  transcript: ExportTranscriptSegment[];
};

export type ExportDocument = {
  formatVersion: number;
  exportedAt: string;
  filter: { section: SectionFilter; difficulties: DifficultyFilter };
  questions: ExportQuestion[];
};

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

// spec: docs/specs/question-export-import.md §Scope — complexity is derived from the sequence.
export function deriveDifficulty(sequence: number): DifficultySlug | null {
  return bandForSequence(sequence)?.slug ?? null;
}

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
// Validates the `section` query value. Throws INVALID_SECTION on anything unexpected.
export function parseSectionFilter(raw: string | undefined): SectionFilter {
  const value = raw ?? "all";
  if (value === "reading" || value === "listening" || value === "all")
    return value;
  throw new ApiError(
    "INVALID_SECTION",
    `Unknown section filter "${value}". Expected reading, listening, or all.`,
  );
}

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
// Parses the `difficulty` query value: "all" (default), or a comma-separated list of band
// slugs. Throws INVALID_DIFFICULTY naming the first unknown slug.
export function parseDifficultyFilter(
  raw: string | undefined,
): DifficultyFilter {
  const value = raw ?? "all";
  if (value === "all" || value === "") return "all";
  const slugs = value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (slugs.length === 0) return "all";
  const known = new Set<string>(BANDS.map((b) => b.slug));
  for (const slug of slugs) {
    if (!known.has(slug)) {
      throw new ApiError(
        "INVALID_DIFFICULTY",
        `Unknown difficulty band "${slug}". Expected one of: ${BANDS.map((b) => b.slug).join(", ")}, or all.`,
      );
    }
  }
  return slugs as DifficultySlug[];
}

// spec: docs/specs/question-export-import.md §Behaviour.3 — a sequence matches when its band is
// in the selected subset; "all" matches everything.
export function sequenceMatchesDifficulty(
  sequence: number,
  filter: DifficultyFilter,
): boolean {
  if (filter === "all") return true;
  const slug = deriveDifficulty(sequence);
  return slug != null && filter.includes(slug);
}

// spec: docs/specs/question-export-import.md §Behaviour.5 — filename slug for a filter axis.
export function filterSlug(value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? "all" : value.join("-");
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// spec: docs/specs/question-export-import.md §Behaviour.14 — per-question label for error messages.
function questionLabel(q: unknown): string {
  if (isPlainObject(q)) {
    const section = typeof q.section === "string" ? q.section : "?";
    const sequence =
      typeof q.sequence === "number" || typeof q.sequence === "string"
        ? q.sequence
        : "?";
    return `${section}/${sequence}`;
  }
  return "?/?";
}

// spec: docs/specs/question-export-import.md §Behaviour.13 — document-level structure. Throws
// INVALID_FORMAT when the envelope is missing/unsupported or `questions` is not an array.
export function assertDocumentShape(
  raw: unknown,
): asserts raw is { questions: unknown[] } {
  if (!isPlainObject(raw)) {
    throw new ApiError(
      "INVALID_FORMAT",
      "Import document must be a JSON object.",
    );
  }
  if (raw.formatVersion !== FORMAT_VERSION) {
    throw new ApiError(
      "INVALID_FORMAT",
      `Unsupported formatVersion ${String(raw.formatVersion)}; this build supports ${FORMAT_VERSION}.`,
    );
  }
  if (!Array.isArray(raw.questions)) {
    throw new ApiError(
      "INVALID_FORMAT",
      'Import document "questions" must be an array.',
    );
  }
}

// spec: docs/specs/question-export-import.md §Behaviour.14 — per-question shape + answer key.
// Throws VALIDATION_FAILED naming the offending key and the question. Returns the question typed.
export function validateQuestion(raw: unknown): ExportQuestion {
  const label = questionLabel(raw);
  const fail = (message: string): never => {
    throw new ApiError("VALIDATION_FAILED", `${message} (question ${label})`);
  };

  if (!isPlainObject(raw)) fail("Question must be an object");
  const q = raw as Record<string, unknown>;

  if (q.section !== "reading" && q.section !== "listening") {
    fail('Invalid "section" (must be reading or listening)');
  }
  if (!isNonEmptyString(q.sourceFile)) fail('Missing or empty "sourceFile"');
  if (
    typeof q.sequence !== "number" ||
    !Number.isInteger(q.sequence) ||
    q.sequence < 1 ||
    q.sequence > 39
  ) {
    fail('Invalid "sequence" (must be an integer 1..39)');
  }
  if (!isNonEmptyString(q.text)) fail('Missing or empty "text"');

  if (!Array.isArray(q.options) || q.options.length !== 4) {
    fail('"options" must be an array of exactly four entries');
  }
  const options = q.options as unknown[];
  const seenLabels = new Set<string>();
  let correctCount = 0;
  for (const opt of options) {
    if (!isPlainObject(opt)) fail("Each option must be an object");
    const o = opt as Record<string, unknown>;
    if (
      typeof o.label !== "string" ||
      !OPTION_LABELS.includes(o.label as "A")
    ) {
      fail('Each option needs a "label" of A, B, C, or D');
    }
    if (seenLabels.has(o.label as string))
      fail(`Duplicate option label "${String(o.label)}"`);
    seenLabels.add(o.label as string);
    if (typeof o.text !== "string") fail('Each option needs a string "text"');
    if (typeof o.isCorrect !== "boolean")
      fail('Each option needs a boolean "isCorrect"');
    if (o.isCorrect) correctCount += 1;
  }
  if (seenLabels.size !== 4)
    fail("Options must be labelled A, B, C, and D exactly once");
  if (correctCount !== 1) fail("Exactly one option must have isCorrect: true");

  if (q.section === "reading") {
    if (q.passage !== null && q.passage !== undefined) {
      if (!isPlainObject(q.passage))
        fail('"passage" must be an object or null');
      const p = q.passage as Record<string, unknown>;
      if (!isNonEmptyString(p.sourceFile))
        fail('Passage needs a non-empty "sourceFile"');
      if (typeof p.text !== "string") fail('Passage needs a string "text"');
    }
  } else {
    // Listening: a transcript array (possibly empty) and an audio reference are required.
    if (!Array.isArray(q.transcript))
      fail('Listening question needs a "transcript" array');
    for (const seg of q.transcript as unknown[]) {
      if (!isPlainObject(seg))
        fail("Each transcript segment must be an object");
      const s = seg as Record<string, unknown>;
      if (typeof s.sequence !== "number")
        fail('Transcript segment needs a numeric "sequence"');
      if (typeof s.text !== "string")
        fail('Transcript segment needs a string "text"');
      if (typeof s.startMs !== "number")
        fail('Transcript segment needs a numeric "startMs"');
      if (typeof s.endMs !== "number")
        fail('Transcript segment needs a numeric "endMs"');
    }
    if (!isPlainObject(q.audio))
      fail('Listening question needs an "audio" reference');
    const a = q.audio as Record<string, unknown>;
    if (!isNonEmptyString(a.fileName))
      fail('Audio reference needs a non-empty "fileName"');
    if (a.durationMs !== null && typeof a.durationMs !== "number") {
      fail('Audio "durationMs" must be a number or null');
    }
  }

  const sequence = q.sequence as number;
  const section = q.section as "reading" | "listening";
  return {
    section,
    sourceFile: (q.sourceFile as string).trim(),
    sequence,
    difficulty: deriveDifficulty(sequence),
    text: q.text as string,
    options: (options as ExportOption[]).map((o) => ({
      label: o.label,
      text: o.text,
      isCorrect: o.isCorrect,
    })),
    passage:
      section === "reading" && isPlainObject(q.passage)
        ? {
            sourceFile: (q.passage.sourceFile as string).trim(),
            text: q.passage.text as string,
          }
        : null,
    audio:
      section === "listening"
        ? {
            fileName: (
              (q.audio as Record<string, unknown>).fileName as string
            ).trim(),
            durationMs:
              ((q.audio as Record<string, unknown>).durationMs as
                number | null) ?? null,
          }
        : null,
    transcript:
      section === "listening"
        ? (q.transcript as ExportTranscriptSegment[]).map((s) => ({
            sequence: s.sequence,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
          }))
        : [],
  };
}

// spec: docs/specs/question-export-import.md §Behaviour.13, 14 — full document validation. Throws
// INVALID_FORMAT / VALIDATION_FAILED; returns the normalised, typed question list on success.
export function validateDocument(raw: unknown): ExportQuestion[] {
  assertDocumentShape(raw);
  return raw.questions.map(validateQuestion);
}
