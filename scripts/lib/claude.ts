import { spawnSync } from 'node:child_process';

// spec: docs/specs/llm-enrichment.md §Behaviour.3–7
// Wraps the LOCAL Claude CLI (not the Anthropic HTTP API) to generate one per-question explanation.
// Following the project's CLI-wrapper convention (cf. scripts/lib/whisper.ts): the prompt builder
// and the response/envelope parsers are pure exported helpers — unit-tested without spawning the
// CLI — and only `runClaude` touches the process. Non-zero exits, a missing binary, and unparseable
// output are surfaced as ClaudeError so the orchestrator can skip a question and continue.

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

export type OptionLabel = 'A' | 'B' | 'C' | 'D';

export type EnrichInput = {
  sequence: number;
  section: 'reading' | 'listening';
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
  'correctReason',
  'optionAReason',
  'optionBReason',
  'optionCReason',
  'optionDReason',
] as const;

// spec: docs/specs/llm-enrichment.md §Behaviour.3c — English, clue-citing, JSON-only prompt. The
// source is the passage (reading) or the transcript (listening); the model must quote the clue.
export function buildEnrichPrompt(input: EnrichInput): string {
  const sourceLabel = input.section === 'reading' ? 'PASSAGE' : 'TRANSCRIPT';
  const sourceWord = input.section === 'reading' ? 'passage' : 'transcript';
  const optionsBlock = input.options
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((o) => `${o.label}. ${o.text}`)
    .join('\n');

  return [
    'You are a tutor for the TCF Canada French exam, explaining a multiple-choice question to a learner.',
    '',
    `Here is the ${sourceLabel} the question is based on:`,
    '"""',
    input.sourceText.trim() || '(no source text available)',
    '"""',
    '',
    `QUESTION ${input.sequence}: ${input.questionText}`,
    '',
    'OPTIONS:',
    optionsBlock,
    '',
    `The correct answer is ${input.correctLabel}.`,
    '',
    'Write every explanation IN ENGLISH (the question and source are in French; explain in English).',
    `For the correct option, explain why it is right and quote the specific clue from the ${sourceWord}`,
    `that proves it. For each incorrect option, explain why it is wrong, pointing to the ${sourceWord}`,
    'where helpful. Keep each reason to one or two sentences.',
    '',
    'Respond with ONLY a JSON object (no surrounding prose, no markdown code fence) of exactly this shape:',
    '{',
    '  "correctReason": "why the correct answer is right, citing the clue",',
    '  "optionAReason": "why A is wrong, or what confirms A if A is the answer",',
    '  "optionBReason": "...",',
    '  "optionCReason": "...",',
    '  "optionDReason": "..."',
    '}',
  ].join('\n');
}

// spec: docs/specs/llm-enrichment.md §Behaviour.3d — extract the first balanced JSON object so a
// stray code fence or surrounding prose doesn't break parsing. Respects string literals/escapes.
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start === -1) throw new ClaudeError('No JSON object found in model output.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new ClaudeError('Unterminated JSON object in model output.');
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
    if (typeof value !== 'string' || value.trim().length === 0) {
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

// spec: docs/specs/llm-enrichment.md §Behaviour.3d — `claude -p --output-format json` wraps the
// model's reply in an envelope; pull out the `result` string (or surface a reported error).
export function parseCliEnvelope(stdout: string): string {
  let env: { is_error?: boolean; result?: unknown };
  try {
    env = JSON.parse(stdout) as typeof env;
  } catch {
    throw new ClaudeError('Claude CLI did not return a JSON envelope (is --output-format json set?).');
  }
  if (env.is_error) {
    const detail = typeof env.result === 'string' ? env.result : 'unknown error';
    throw new ClaudeError(`Claude CLI reported an error: ${detail}`);
  }
  if (typeof env.result !== 'string') {
    throw new ClaudeError('Claude CLI envelope had no string "result".');
  }
  return env.result;
}

export type RunClaudeOptions = { bin?: string; model?: string; timeoutMs?: number };

// spec: docs/specs/llm-enrichment.md §Behaviour.2, 3d, 7 — invoke the local CLI non-interactively
// and return the model's reply text. CLI config comes from .env (CLAUDE_CLI_BIN/CLAUDE_CLI_MODEL).
export function runClaude(prompt: string, opts: RunClaudeOptions = {}): string {
  const bin = opts.bin ?? process.env.CLAUDE_CLI_BIN ?? 'claude';
  const model = opts.model ?? process.env.CLAUDE_CLI_MODEL;
  const args = ['-p', prompt, '--output-format', 'json'];
  if (model) args.push('--model', model);

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 180_000,
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ClaudeError(
        `Claude CLI not found (${bin}). Install the Claude CLI or set CLAUDE_CLI_BIN in .env.`,
      );
    }
    throw new ClaudeError(`Claude CLI failed to run: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new ClaudeError(`Claude CLI exited ${result.status}: ${result.stderr?.trim() ?? ''}`);
  }
  return parseCliEnvelope(result.stdout);
}

// spec: docs/specs/llm-enrichment.md §Behaviour.3–4 — build the prompt, call the CLI, parse the
// explanation. The `model` label (for `generated_by`) is whatever was configured, or "default".
export function generateExplanation(
  input: EnrichInput,
  opts: RunClaudeOptions = {},
): { explanation: Explanation; raw: string } {
  const prompt = buildEnrichPrompt(input);
  const raw = runClaude(prompt, opts);
  return { explanation: parseExplanationResponse(raw), raw };
}
