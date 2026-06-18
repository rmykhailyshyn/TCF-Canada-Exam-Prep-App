import {
  ClaudeError,
  type RunClaudeOptions,
  extractJsonObject,
  runClaude,
} from '../lib/claude-cli';

// spec: docs/specs/speaking-evaluation.md
// Request-time local-Claude-CLI layer for the Speaking section: scoring + feedback on submit (both
// modes) and an on-request correction (training only). Mirrors server/services/writingEvaluation.ts
// and reuses the shared CLI primitives (server/lib/claude-cli). The prompt builders and JSON parsers
// are pure and unit-tested; only the `*WithClaude` functions touch the process. A CLI/parse failure
// surfaces as ClaudeError so the caller (server/services/speaking.ts) can return EVALUATION_FAILED /
// CORRECTION_FAILED. The NCLC level is NOT produced here — it is derived from the score by
// server/lib/nclc.ts on read.

export type SpeakingFeedback = {
  strengths: string;
  errors: string;
  improvements: string;
};

// The model produces only the score + feedback; the NCLC level is derived from the score elsewhere
// (server/lib/nclc.ts), never by the model.
export type SpeakingScore = {
  score: number;
  feedback: SpeakingFeedback;
};

export type SpeakingCorrection = {
  correctedText: string;
  suggestions: string[];
};

export type EvaluateInput = {
  taskNumber: number;
  question: string;
  transcript: string;
};

export type CorrectInput = {
  question: string;
  transcript: string;
};

// spec: docs/specs/speaking-evaluation.md §Behaviour.6 — scoring prompt (score 0–20 + feedback only).
// The candidate's spoken answer reaches the model as a Whisper transcript (French); the model acts as
// a TCF Expression orale examiner and writes feedback in English.
export function buildScorePrompt(input: EvaluateInput): string {
  return [
    'You are an examiner for the TCF Canada French exam, Expression orale (speaking) section.',
    `You are grading the spoken response to speaking task ${input.taskNumber}.`,
    'The response was recorded by the candidate and automatically transcribed (so disfluencies,',
    'repetitions, or transcription artefacts may appear) — grade the spoken performance, not spelling.',
    '',
    'TASK PROMPT (in French):',
    '"""',
    input.question.trim(),
    '"""',
    '',
    "CANDIDATE'S TRANSCRIBED RESPONSE (in French):",
    '"""',
    input.transcript.trim() || '(empty response)',
    '"""',
    '',
    'Assess it against the official TCF criteria (task achievement, fluency and coherence, lexical',
    'range, grammatical range and accuracy). Give a single integer score from 0 to 20.',
    'Write the feedback IN ENGLISH (the response is in French).',
    '',
    'Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of this shape:',
    '{',
    '  "score": 0,',
    '  "strengths": "what the response does well",',
    '  "errors": "notable grammar / vocabulary / fluency / coherence issues",',
    '  "improvements": "concrete suggestions to raise the score"',
    '}',
  ].join('\n');
}

// spec: docs/specs/speaking-evaluation.md §Behaviour.6, 8 — parse + validate the score reply.
export function parseScoreResponse(raw: string): SpeakingScore {
  const obj = parseObject(raw);
  const score = obj.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    throw new ClaudeError('Model output is missing a numeric "score".');
  }
  const clamped = Math.max(0, Math.min(20, Math.round(score)));
  return {
    score: clamped,
    feedback: {
      strengths: requireString(obj.strengths, 'strengths'),
      errors: requireString(obj.errors, 'errors'),
      improvements: requireString(obj.improvements, 'improvements'),
    },
  };
}

// spec: docs/specs/speaking-evaluation.md §Behaviour.9 — correction prompt (training only).
export function buildCorrectionPrompt(input: CorrectInput): string {
  return [
    'You are a French speaking tutor helping a TCF Canada candidate improve a spoken answer.',
    'The answer below is an automatic transcript of what the candidate said.',
    '',
    'TASK PROMPT (in French):',
    '"""',
    input.question.trim(),
    '"""',
    '',
    "CANDIDATE'S TRANSCRIBED ANSWER (in French):",
    '"""',
    input.transcript.trim() || '(empty answer)',
    '"""',
    '',
    'Rewrite the answer in correct, natural spoken French, keeping the candidate\'s intent and meaning.',
    'Then list specific suggestions (in English) explaining what you changed and what to try next.',
    '',
    'Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of this shape:',
    '{',
    '  "correctedText": "the answer rewritten in correct French",',
    '  "suggestions": ["specific note 1", "specific note 2"]',
    '}',
  ].join('\n');
}

// spec: docs/specs/speaking-evaluation.md §Behaviour.9–10 — parse + validate the correction reply.
export function parseCorrectionResponse(raw: string): SpeakingCorrection {
  const obj = parseObject(raw);
  const correctedText = requireString(obj.correctedText, 'correctedText');
  const rawSuggestions = obj.suggestions;
  if (!Array.isArray(rawSuggestions)) {
    throw new ClaudeError('Model output is missing a "suggestions" array.');
  }
  const suggestions = rawSuggestions
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
  return { correctedText, suggestions };
}

// spec: docs/specs/speaking-evaluation.md §Behaviour.6 — score a submitted response via the CLI.
export function scoreWithClaude(input: EvaluateInput, opts: RunClaudeOptions = {}): SpeakingScore {
  return parseScoreResponse(runClaude(buildScorePrompt(input), opts));
}

// spec: docs/specs/speaking-evaluation.md §Behaviour.9 — correct an answer via the CLI.
export function correctWithClaude(
  input: CorrectInput,
  opts: RunClaudeOptions = {},
): SpeakingCorrection {
  return parseCorrectionResponse(runClaude(buildCorrectionPrompt(input), opts));
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
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ClaudeError(`Model output is missing a non-empty "${field}".`);
  }
  return value.trim();
}
