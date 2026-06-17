import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// Single source of truth for the database schema. Each table maps to the data model
// defined in the corresponding feature spec; run `npm run db:generate` after any change.
//
// Indexes: Postgres auto-indexes primary keys and UNIQUE constraints but NOT plain foreign-key
// columns. We add explicit indexes on the FK / filter columns that the session and player queries
// join or filter on (most importantly question_results.session_id, joined on every history,
// results, and review read). spec: docs/milestones.md §Milestone 9 (performance review).

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
    // Session creation filters the whole section by `section` before resolving the question set.
    index('questions_section_idx').on(table.section),
    index('questions_passage_id_idx').on(table.passageId),
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
  (table) => [
    check('options_label_check', sql`${table.label} in ('A', 'B', 'C', 'D')`),
    // Options are loaded by question_id for the resolved question set on every session start.
    index('options_question_id_idx').on(table.questionId),
  ],
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
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: serial('id').primaryKey(),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id),
    sequence: integer('sequence').notNull(),
    text: text('text').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
  },
  // The player loads a question's segments by question_id, ordered by sequence.
  (table) => [index('transcript_segments_question_id_idx').on(table.questionId)],
);

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
    // Writing sessions reuse this table (spec: docs/specs/writing-session.md §Data model changes).
    check('sessions_section_check', sql`${table.section} in ('reading', 'listening', 'writing')`),
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
    // Hot path: completion, history and review all filter/join question_results by session_id;
    // scoring joins back to questions by question_id.
    index('question_results_session_id_idx').on(table.sessionId),
    index('question_results_question_id_idx').on(table.questionId),
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

// spec: docs/specs/writing-import.md §Data model changes
// The authored Writing task bank. Natural key (source_file, task_number) mirrors questions; a
// task_number (1–3) may have multiple candidates that the per-session draw selects from.
export const writingTasks = pgTable(
  'writing_tasks',
  {
    id: serial('id').primaryKey(),
    sourceFile: text('source_file').notNull(),
    taskNumber: integer('task_number').notNull(),
    title: text('title'),
    prompt: text('prompt').notNull(),
    instructions: text('instructions'),
    minWords: integer('min_words'),
    maxWords: integer('max_words'),
    sampleAnswer: text('sample_answer'),
    template: text('template'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('writing_tasks_source_file_task_number_unique').on(table.sourceFile, table.taskNumber),
    check('writing_tasks_task_number_check', sql`${table.taskNumber} between 1 and 3`),
    // Session creation filters/draws by task_number.
    index('writing_tasks_task_number_idx').on(table.taskNumber),
  ],
);

// spec: docs/specs/writing-session.md §Data model changes
// One free-text response per task per writing session (drafts autosaved; submitted_at set on submit).
export const writingResponses = pgTable(
  'writing_responses',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id),
    writingTaskId: integer('writing_task_id')
      .notNull()
      .references(() => writingTasks.id),
    taskNumber: integer('task_number').notNull(),
    responseText: text('response_text').notNull().default(''),
    wordCount: integer('word_count'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => [
    unique('writing_responses_session_task_unique').on(table.sessionId, table.taskNumber),
    check('writing_responses_task_number_check', sql`${table.taskNumber} between 1 and 3`),
    index('writing_responses_session_id_idx').on(table.sessionId),
  ],
);

// spec: docs/specs/writing-evaluation.md §Data model changes
// Claude's score (0–20) + feedback for one response. The NCLC level is NOT stored — it is derived
// deterministically from `score` on read (writing-evaluation §Score → NCLC).
export const writingEvaluations = pgTable(
  'writing_evaluations',
  {
    id: serial('id').primaryKey(),
    responseId: integer('response_id')
      .notNull()
      .unique()
      .references(() => writingResponses.id),
    score: integer('score').notNull(),
    strengths: text('strengths').notNull(),
    errors: text('errors').notNull(),
    improvements: text('improvements').notNull(),
    generatedBy: text('generated_by').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('writing_evaluations_score_check', sql`${table.score} between 0 and 20`)],
);
