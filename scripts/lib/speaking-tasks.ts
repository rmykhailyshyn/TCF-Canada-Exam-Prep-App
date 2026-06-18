// spec: docs/specs/speaking-import.md §Behaviour.2–4
// Pure parser for a Speaking task bank: a single JSON file holding an array of
// `{ task, question, answer }` objects. Unlike the Writing import (a directory of markdown), the
// source here is one JSON document, so this validates the parsed array element-by-element and
// returns a skip-with-reason result per element rather than throwing on the first bad entry. It is
// pure and unit-tested; the orchestrator (scripts/import-speaking.ts) handles file I/O, the DB
// upsert, and progress reporting. `sequence` is the element's 0-based index in the array.

export class SpeakingTaskParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpeakingTaskParseError';
  }
}

export type ParsedSpeakingTask = {
  sequence: number;
  taskNumber: number;
  question: string;
  sampleAnswer: string | null;
};

// One element's outcome: either a validated task, or a skip carrying its index + reason.
export type SpeakingTaskParseResult =
  | { ok: true; task: ParsedSpeakingTask }
  | { ok: false; sequence: number; reason: string };

// Parse the whole file's JSON text into per-element results. Throws SpeakingTaskParseError only when
// the document itself is unusable (not valid JSON, or not an array) — individual bad elements are
// returned as `{ ok: false }` so the caller can skip-and-continue (Behaviour.4).
export function parseSpeakingTasks(jsonText: string): SpeakingTaskParseResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new SpeakingTaskParseError(
      `file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new SpeakingTaskParseError('file must contain a JSON array of task objects');
  }

  return parsed.map((element, sequence) => parseElement(element, sequence));
}

// spec: docs/specs/speaking-import.md §Behaviour.3–4 — validate a single array element.
function parseElement(element: unknown, sequence: number): SpeakingTaskParseResult {
  if (typeof element !== 'object' || element === null || Array.isArray(element)) {
    return { ok: false, sequence, reason: 'element is not a JSON object' };
  }
  const obj = element as Record<string, unknown>;

  const task = obj.task;
  if (typeof task !== 'number' || !Number.isInteger(task) || task < 1 || task > 3) {
    return { ok: false, sequence, reason: `task must be an integer 1–3 (got ${JSON.stringify(task)})` };
  }

  const question = obj.question;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { ok: false, sequence, reason: 'question must be a non-empty string' };
  }

  const answer = obj.answer;
  if (answer != null && typeof answer !== 'string') {
    return { ok: false, sequence, reason: 'answer, when present, must be a string' };
  }
  const sampleAnswer = typeof answer === 'string' && answer.trim().length > 0 ? answer.trim() : null;

  return {
    ok: true,
    task: { sequence, taskNumber: task, question: question.trim(), sampleAnswer },
  };
}
