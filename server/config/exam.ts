import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// spec: docs/specs/quiz-session.md §Configuration.18
// Exam time limits are read from exam.config.json at the repo root, never hardcoded.

export type Section = 'reading' | 'listening';

type SectionConfig = { timeLimitMinutes: number; questionCount: number };
// spec: docs/specs/writing-session.md §Configuration.17 — writing has a single time limit and a task count.
type WritingConfig = { timeLimitMinutes: number; taskCount: number };
type ExamConfig = { reading: SectionConfig; listening: SectionConfig; writing: WritingConfig };

let cached: ExamConfig | null = null;

// spec: docs/specs/quiz-session.md §Configuration.18
export function getExamConfig(): ExamConfig {
  if (!cached) {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '../../exam.config.json');
    cached = JSON.parse(readFileSync(path, 'utf8')) as ExamConfig;
  }
  return cached;
}

// spec: docs/specs/quiz-session.md §Real mode.8 — timer initialised from the configured limit.
export function getTimeLimitMs(section: Section): number {
  return getExamConfig()[section].timeLimitMinutes * 60_000;
}

// spec: docs/specs/writing-session.md §Configuration.17 — the single 60-min real-mode budget.
export function getWritingTimeLimitMs(): number {
  return getExamConfig().writing.timeLimitMinutes * 60_000;
}

// spec: docs/specs/writing-session.md §Task selection — the number of writing tasks (3).
export function getWritingTaskCount(): number {
  return getExamConfig().writing.taskCount;
}
