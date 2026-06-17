// spec: docs/specs/writing-import.md §Behaviour.3–4
// Pure parser for a Writing task markdown file: YAML-ish front-matter + titled body sections. The
// repo has no YAML/markdown dependency, so this is a minimal hand-rolled parser (cf. the
// project's other hand-rolled parsers in scripts/lib). It is pure and unit-tested; the orchestrator
// (scripts/import-writing.ts) handles file discovery, the DB upsert, and skip-and-continue.

export class TaskParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskParseError';
  }
}

export type ParsedTask = {
  taskNumber: number;
  title: string | null;
  prompt: string;
  instructions: string | null;
  minWords: number | null;
  maxWords: number | null;
  sampleAnswer: string | null;
  template: string | null;
};

type FrontMatter = { yaml: Record<string, string>; body: string };

// Split leading `---` front-matter from the markdown body. Throws if the fence is missing or
// unterminated (Behaviour.4 — such a file is skipped by the caller).
export function splitFrontMatter(content: string): FrontMatter {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!/^---\s*\n/.test(normalized)) {
    throw new TaskParseError('missing front-matter (file must start with a --- fence)');
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    throw new TaskParseError('unterminated front-matter (no closing --- fence)');
  }
  const yamlText = normalized.slice(normalized.indexOf('\n') + 1, end);
  const afterFence = normalized.indexOf('\n', end + 1);
  const body = afterFence === -1 ? '' : normalized.slice(afterFence + 1);

  const yaml: Record<string, string> = {};
  for (const line of yamlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) yaml[key] = value;
  }
  return { yaml, body };
}

// Split the body into instructions (text before the first `##`) + a map of lowercased heading → text.
export function splitSections(body: string): { instructions: string; sections: Map<string, string> } {
  const lines = body.split('\n');
  const sections = new Map<string, string>();
  const instructions: string[] = [];
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (current != null) sections.set(current, buffer.join('\n').trim());
  };

  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1].toLowerCase().trim();
      buffer = [];
    } else if (current != null) {
      buffer.push(line);
    } else {
      instructions.push(line);
    }
  }
  flush();
  return { instructions: instructions.join('\n').trim(), sections };
}

function parseOptionalInt(raw: string | undefined, field: string): number | null {
  if (raw == null || raw === '') return null;
  if (!/^\d+$/.test(raw)) throw new TaskParseError(`${field} must be a non-negative integer`);
  return Number(raw);
}

// Parse a full task file into a validated ParsedTask, or throw TaskParseError (Behaviour.3, 4).
export function parseTaskFile(content: string): ParsedTask {
  const { yaml, body } = splitFrontMatter(content);

  if (!/^\d+$/.test(yaml.taskNumber ?? '')) {
    throw new TaskParseError('taskNumber is required and must be an integer 1–3');
  }
  const taskNumber = Number(yaml.taskNumber);
  if (taskNumber < 1 || taskNumber > 3) {
    throw new TaskParseError(`taskNumber must be between 1 and 3 (got ${taskNumber})`);
  }

  const { instructions, sections } = splitSections(body);
  const prompt = sections.get('prompt')?.trim() ?? '';
  if (!prompt) {
    throw new TaskParseError('a non-empty "## Prompt" section is required');
  }

  return {
    taskNumber,
    title: yaml.title ? yaml.title : null,
    prompt,
    instructions: instructions || null,
    minWords: parseOptionalInt(yaml.minWords, 'minWords'),
    maxWords: parseOptionalInt(yaml.maxWords, 'maxWords'),
    sampleAnswer: sections.get('sample answer')?.trim() || null,
    template: sections.get('template')?.trim() || null,
  };
}
