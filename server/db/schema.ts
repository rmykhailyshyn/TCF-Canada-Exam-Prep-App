import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// Single source of truth for the database schema. Each table maps to the data model
// defined in the corresponding feature spec; run `npm run db:generate` after any change.

// spec: docs/specs/reading-import.md §Data model changes
export const passages = pgTable('passages', {
  id: serial('id').primaryKey(),
  sourceFile: text('source_file').notNull().unique(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// spec: docs/specs/reading-import.md §Data model changes (shared by listening-import.md)
export const questions = pgTable(
  'questions',
  {
    id: serial('id').primaryKey(),
    passageId: integer('passage_id').references(() => passages.id),
    sourceFile: text('source_file').notNull(),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    section: text('section').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotency key: one source file (PDF) yields many questions, unique by position.
    unique('questions_source_file_sequence_unique').on(table.sourceFile, table.sequence),
    check('questions_section_check', sql`${table.section} in ('reading', 'listening')`),
  ],
);

// spec: docs/specs/reading-import.md §Data model changes
export const options = pgTable(
  'options',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id),
    label: text('label').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (table) => [check('options_label_check', sql`${table.label} in ('A', 'B', 'C', 'D')`)],
);

// spec: docs/specs/listening-import.md §Data model changes
export const audioFiles = pgTable('audio_files', {
  id: serial('id').primaryKey(),
  questionId: integer('question_id')
    .notNull()
    .unique()
    .references(() => questions.id),
  filePath: text('file_path').notNull().unique(),
  durationMs: integer('duration_ms'),
});

// spec: docs/specs/listening-import.md §Data model changes
export const transcriptSegments = pgTable('transcript_segments', {
  id: serial('id').primaryKey(),
  questionId: integer('question_id')
    .notNull()
    .references(() => questions.id),
  sequence: integer('sequence').notNull(),
  text: text('text').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
});

// spec: docs/specs/quiz-session.md §Data model changes
export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    section: text('section').notNull(),
    mode: text('mode').notNull(),
    // Learning mode only; one of the six difficulty band slugs; null in real mode.
    difficulty: text('difficulty'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    elapsedMs: integer('elapsed_ms'),
  },
  (table) => [
    check('sessions_section_check', sql`${table.section} in ('reading', 'listening')`),
    check('sessions_mode_check', sql`${table.mode} in ('learning', 'real')`),
    check(
      'sessions_difficulty_check',
      sql`${table.difficulty} is null or ${table.difficulty} in ('beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'expert')`,
    ),
  ],
);

// spec: docs/specs/quiz-session.md §Data model changes
export const questionResults = pgTable(
  'question_results',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id),
    chosenLabel: text('chosen_label').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('question_results_chosen_label_check', sql`${table.chosenLabel} in ('A', 'B', 'C', 'D')`),
  ],
);

// spec: docs/specs/llm-enrichment.md §Data model changes
export const explanations = pgTable('explanations', {
  id: serial('id').primaryKey(),
  questionId: integer('question_id')
    .notNull()
    .unique()
    .references(() => questions.id),
  correctReason: text('correct_reason').notNull(),
  optionAReason: text('option_a_reason').notNull(),
  optionBReason: text('option_b_reason').notNull(),
  optionCReason: text('option_c_reason').notNull(),
  optionDReason: text('option_d_reason').notNull(),
  generatedBy: text('generated_by').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});
