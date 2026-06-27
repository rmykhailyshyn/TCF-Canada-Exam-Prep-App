// spec: docs/specs/llm-enrichment.md §Behaviour.3–7
// Builds the per-question enrichment prompt and parses the model's Explanation reply. The CLI
// primitives (ClaudeError, runClaude, JSON extraction, envelope parsing) live in the shared
// server/lib/claude-cli module so the request-time writing evaluation service can reuse them; they
// are re-exported here for backward compatibility with existing importers/tests.
import {
  ClaudeError,
  type JsonSchema,
  type RunClaudeOptions,
  extractJsonObject,
  parseCliEnvelope,
  runClaude,
  runClaudeJson,
} from "../../server/lib/claude-cli";

export {
  ClaudeError,
  extractJsonObject,
  parseCliEnvelope,
  runClaude,
  runClaudeJson,
};
export type { JsonSchema, RunClaudeOptions };

export type OptionLabel = "A" | "B" | "C" | "D";

export type EnrichInput = {
  sequence: number;
  section: "reading" | "listening";
  questionText: string;
  options: { label: OptionLabel; text: string }[];
  correctLabel: OptionLabel;
  // Passage text (reading) or the concatenated transcript (listening) — the source of the clues.
  sourceText: string;
};

export type Explanation = {
  correctReason: string;
  optionAReason: string;
  optionBReason: string;
  optionCReason: string;
  optionDReason: string;
};

const REASON_FIELDS = [
  "correctReason",
  "optionAReason",
  "optionBReason",
  "optionCReason",
  "optionDReason",
] as const;

// spec: docs/specs/llm-enrichment.md §Behaviour.3f — the strict JSON Schema passed to the CLI via
// --json-schema so the model's content is constrained to the five non-empty reason strings.
export const EXPLANATION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [...REASON_FIELDS],
  properties: Object.fromEntries(
    REASON_FIELDS.map((field) => [field, { type: "string", minLength: 1 }]),
  ),
};

// spec: docs/specs/llm-enrichment.md §Behaviour.3c — English, clue-citing, JSON-only prompt. The
// source is the passage (reading) or the transcript (listening); the model must quote the clue.
export function buildEnrichPrompt(input: EnrichInput): string {
  const sourceLabel = input.section === "reading" ? "PASSAGE" : "TRANSCRIPT";
  const sourceWord = input.section === "reading" ? "passage" : "transcript";
  const optionsBlock = input.options
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `${o.label}. ${o.text}`)
    .join("\n");

  return [
    "You are a tutor for the TCF Canada French exam, explaining a multiple-choice question to a learner.",
    "",
    `Here is the ${sourceLabel} the question is based on:`,
    '"""',
    input.sourceText.trim() || "(no source text available)",
    '"""',
    "",
    `QUESTION ${input.sequence}: ${input.questionText}`,
    "",
    "OPTIONS:",
    optionsBlock,
    "",
    `The correct answer is ${input.correctLabel}.`,
    "",
    "Write every explanation IN ENGLISH (the question and source are in French; explain in English).",
    `For the correct option, explain why it is right and quote the specific clue from the ${sourceWord}`,
    `that proves it. For each incorrect option, explain why it is wrong, pointing to the ${sourceWord}`,
    "where helpful. Keep each reason to one or two sentences.",
    "",
    "Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of exactly this shape:",
    "{",
    '  "correctReason": "why the correct answer is right, citing the clue",',
    '  "optionAReason": "why A is wrong, or what confirms A if A is the answer",',
    '  "optionBReason": "...",',
    '  "optionCReason": "...",',
    '  "optionDReason": "..."',
    "}",
  ].join("\n");
}

// spec: docs/specs/llm-enrichment.md §Behaviour.4, 7 — parse the model's reply into a validated
// Explanation (five non-empty reasons), or throw so the question is skipped.
export function parseExplanationResponse(raw: string): Explanation {
  const slice = extractJsonObject(raw);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(slice) as Record<string, unknown>;
  } catch (error) {
    throw new ClaudeError(
      `Model output was not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
  for (const field of REASON_FIELDS) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ClaudeError(`Model output is missing a non-empty "${field}".`);
    }
  }
  return {
    correctReason: (obj.correctReason as string).trim(),
    optionAReason: (obj.optionAReason as string).trim(),
    optionBReason: (obj.optionBReason as string).trim(),
    optionCReason: (obj.optionCReason as string).trim(),
    optionDReason: (obj.optionDReason as string).trim(),
  };
}

// spec: docs/specs/llm-enrichment.md §Behaviour.3–4, 3g — build the prompt, call the CLI grounded by
// the EXPLANATION_SCHEMA, and parse the explanation (retrying on a parse failure via runClaudeJson).
export function generateExplanation(
  input: EnrichInput,
  opts: RunClaudeOptions = {},
): { explanation: Explanation } {
  const explanation = runClaudeJson(
    buildEnrichPrompt(input),
    parseExplanationResponse,
    { ...opts, jsonSchema: EXPLANATION_SCHEMA },
  );
  return { explanation };
}
