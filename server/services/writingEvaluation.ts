import {
  ClaudeError,
  type JsonSchema,
  type RunClaudeOptions,
  extractJsonObject,
  runClaudeJson,
} from "../lib/claude-cli";

// spec: docs/specs/writing-evaluation.md §Behaviour.2 — strict JSON Schemas passed to the CLI via
// --json-schema so the model's scoring/correction content is constrained to the expected shape.
const SCORE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "strengths", "errors", "improvements"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 20 },
    strengths: { type: "string", minLength: 1 },
    errors: { type: "string", minLength: 1 },
    improvements: { type: "string", minLength: 1 },
  },
};

const CORRECTION_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correctedText", "suggestions"],
  properties: {
    correctedText: { type: "string", minLength: 1 },
    suggestions: { type: "array", items: { type: "string" } },
  },
};

// spec: docs/specs/writing-evaluation.md
// Request-time local-Claude-CLI layer for the Writing section: scoring + feedback on submit (both
// modes) and an on-request correction (training only). Reuses the shared CLI primitives
// (server/lib/claude-cli). The prompt builders and JSON parsers are pure and unit-tested; only the
// `*WithClaude` functions touch the process. A CLI/parse failure surfaces as ClaudeError so the
// caller (server/services/writing.ts) can return EVALUATION_FAILED / CORRECTION_FAILED.

export type WritingFeedback = {
  strengths: string;
  errors: string;
  improvements: string;
};

// The model produces only the score + feedback; the NCLC level is derived from the score elsewhere
// (server/lib/nclc.ts), never by the model.
export type WritingScore = {
  score: number;
  feedback: WritingFeedback;
};

export type WritingCorrection = {
  correctedText: string;
  suggestions: string[];
};

export type EvaluateInput = {
  taskNumber: number;
  prompt: string;
  minWords: number | null;
  maxWords: number | null;
  responseText: string;
};

export type CorrectInput = {
  prompt: string;
  responseText: string;
};

function wordGuidance(
  minWords: number | null,
  maxWords: number | null,
): string {
  if (minWords != null && maxWords != null)
    return `${minWords}–${maxWords} words`;
  if (minWords != null) return `at least ${minWords} words`;
  if (maxWords != null) return `at most ${maxWords} words`;
  return "no specific length requirement";
}

// spec: docs/specs/writing-evaluation.md §Behaviour.3 — scoring prompt (score 0–20 + feedback only).
export function buildScorePrompt(input: EvaluateInput): string {
  return [
    "You are an examiner for the TCF Canada French exam, Expression écrite (writing) section.",
    `You are grading the response to writing task ${input.taskNumber}.`,
    `Expected length: ${wordGuidance(input.minWords, input.maxWords)}.`,
    "",
    "TASK PROMPT (in French):",
    '"""',
    input.prompt.trim(),
    '"""',
    "",
    "CANDIDATE'S RESPONSE (in French):",
    '"""',
    input.responseText.trim() || "(empty response)",
    '"""',
    "",
    "Assess it against the official TCF criteria (task achievement, coherence/cohesion, lexical",
    "range, grammatical range and accuracy, register). Give a single integer score from 0 to 20.",
    "Write the feedback IN ENGLISH (the response is in French).",
    "",
    "Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of this shape:",
    "{",
    '  "score": 0,',
    '  "strengths": "what the response does well",',
    '  "errors": "notable grammar / vocabulary / register / coherence errors",',
    '  "improvements": "concrete suggestions to raise the score"',
    "}",
  ].join("\n");
}

// spec: docs/specs/writing-evaluation.md §Behaviour.3–4 — parse + validate the score reply.
export function parseScoreResponse(raw: string): WritingScore {
  const obj = parseObject(raw);
  const score = obj.score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new ClaudeError('Model output is missing a numeric "score".');
  }
  const clamped = Math.max(0, Math.min(20, Math.round(score)));
  return {
    score: clamped,
    feedback: {
      strengths: requireString(obj.strengths, "strengths"),
      errors: requireString(obj.errors, "errors"),
      improvements: requireString(obj.improvements, "improvements"),
    },
  };
}

// spec: docs/specs/writing-evaluation.md §Behaviour.7 — correction prompt (training only).
export function buildCorrectionPrompt(input: CorrectInput): string {
  return [
    "You are a French writing tutor helping a TCF Canada candidate improve a draft.",
    "",
    "TASK PROMPT (in French):",
    '"""',
    input.prompt.trim(),
    '"""',
    "",
    "CANDIDATE'S CURRENT DRAFT (in French):",
    '"""',
    input.responseText.trim() || "(empty draft)",
    '"""',
    "",
    "Rewrite the draft in correct, natural French, keeping the candidate's intent and meaning.",
    "Then list specific suggestions (in English) explaining what you changed and what to try next.",
    "",
    "Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of this shape:",
    "{",
    '  "correctedText": "the draft rewritten in correct French",',
    '  "suggestions": ["specific note 1", "specific note 2"]',
    "}",
  ].join("\n");
}

// spec: docs/specs/writing-evaluation.md §Behaviour.7–8 — parse + validate the correction reply.
export function parseCorrectionResponse(raw: string): WritingCorrection {
  const obj = parseObject(raw);
  const correctedText = requireString(obj.correctedText, "correctedText");
  const rawSuggestions = obj.suggestions;
  if (!Array.isArray(rawSuggestions)) {
    throw new ClaudeError('Model output is missing a "suggestions" array.');
  }
  const suggestions = rawSuggestions
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());
  return { correctedText, suggestions };
}

// spec: docs/specs/writing-evaluation.md §Behaviour.3, 2 — score a submitted response via the grounded
// CLI path (schema-constrained, JSON-only system prompt, retried on parse failure).
export function scoreWithClaude(
  input: EvaluateInput,
  opts: RunClaudeOptions = {},
): WritingScore {
  return runClaudeJson(buildScorePrompt(input), parseScoreResponse, {
    ...opts,
    jsonSchema: SCORE_SCHEMA,
  });
}

// spec: docs/specs/writing-evaluation.md §Behaviour.7, 2 — correct a draft via the grounded CLI path.
export function correctWithClaude(
  input: CorrectInput,
  opts: RunClaudeOptions = {},
): WritingCorrection {
  return runClaudeJson(buildCorrectionPrompt(input), parseCorrectionResponse, {
    ...opts,
    jsonSchema: CORRECTION_SCHEMA,
  });
}

function parseObject(raw: string): Record<string, unknown> {
  const slice = extractJsonObject(raw);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch (error) {
    throw new ClaudeError(
      `Model output was not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ClaudeError(`Model output is missing a non-empty "${field}".`);
  }
  return value.trim();
}
