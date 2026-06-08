import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// spec: docs/specs/quiz-session.md §Configuration.18
// Exam time limits are read from exam.config.json at the repo root, never hardcoded.

export type Section = 'reading' | 'listening';

type SectionConfig = { timeLimitMinutes: number; questionCount: number };
type ExamConfig = { reading: SectionConfig; listening: SectionConfig };

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
