import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// Single source of truth for the database schema. Each table maps to the data model
// defined in the corresponding feature spec; run `npm run db:generate` after any change.
//
// Engine: SQLite via libSQL (spec: docs/specs/database-sqlite.md). The same sqlite-core schema
// also targets Cloudflare D1 (itself SQLite) in a later milestone. Type representations differ
// from the previous Postgres schema but the data model is unchanged: `serial` → `integer
// autoincrement`, `boolean` → `integer {mode: 'boolean'}`, `timestamp` → `integer {mode:
// 'timestamp'}` (unix seconds ↔ JS Date), defaulting to `(unixepoch())` for "now".
//
// Indexes: SQLite auto-indexes primary keys and UNIQUE constraints but NOT plain foreign-key
// columns. We add explicit indexes on the FK / filter columns that the session and player queries
// join or filter on (most importantly question_results.session_id, joined on every history,
// results, and review read). spec: docs/milestones.md §Milestone 9 (performance review).

// spec: docs/specs/reading-import.md §Data model changes
export const passages = sqliteTable("passages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceFile: text("source_file").notNull().unique(),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// spec: docs/specs/reading-import.md §Data model changes (shared by listening-import.md)
export const questions = sqliteTable(
  "questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    passageId: integer("passage_id").references(() => passages.id),
    sourceFile: text("source_file").notNull(),
    sequence: integer("sequence").notNull(),
    text: text("text").notNull(),
    section: text("section").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    // Idempotency key: one source file (PDF) yields many questions, unique by position.
    unique("questions_source_file_sequence_unique").on(
      table.sourceFile,
      table.sequence,
    ),
    check(
      "questions_section_check",
      sql`${table.section} in ('reading', 'listening')`,
    ),
    // Session creation filters the whole section by `section` before resolving the question set.
    index("questions_section_idx").on(table.section),
    index("questions_passage_id_idx").on(table.passageId),
  ],
);

// spec: docs/specs/reading-import.md §Data model changes
export const options = sqliteTable(
  "options",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    label: text("label").notNull(),
    text: text("text").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
  },
  (table) => [
    check("options_label_check", sql`${table.label} in ('A', 'B', 'C', 'D')`),
    // Options are loaded by question_id for the resolved question set on every session start.
    index("options_question_id_idx").on(table.questionId),
  ],
);

// spec: docs/specs/listening-import.md §Data model changes
export const audioFiles = sqliteTable("audio_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .unique()
    .references(() => questions.id),
  filePath: text("file_path").notNull().unique(),
  durationMs: integer("duration_ms"),
});

// spec: docs/specs/listening-import.md §Data model changes
export const transcriptSegments = sqliteTable(
  "transcript_segments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    sequence: integer("sequence").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
  },
  // The player loads a question's segments by question_id, ordered by sequence.
  (table) => [
    index("transcript_segments_question_id_idx").on(table.questionId),
  ],
);

// spec: docs/specs/quiz-session.md §Data model changes
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    section: text("section").notNull(),
    mode: text("mode").notNull(),
    // Learning mode only; one of the six difficulty band slugs; null in real mode.
    difficulty: text("difficulty"),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    elapsedMs: integer("elapsed_ms"),
  },
  (table) => [
    // Writing + speaking sessions reuse this table (spec: docs/specs/writing-session.md +
    // docs/specs/speaking-session.md §Data model changes).
    check(
      "sessions_section_check",
      sql`${table.section} in ('reading', 'listening', 'writing', 'speaking')`,
    ),
    check("sessions_mode_check", sql`${table.mode} in ('learning', 'real')`),
    check(
      "sessions_difficulty_check",
      sql`${table.difficulty} is null or ${table.difficulty} in ('beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'expert')`,
    ),
  ],
);

// spec: docs/specs/quiz-session.md §Data model changes
export const questionResults = sqliteTable(
  "question_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    questionId: integer("question_id")
      .notNull()
      .references(() => questions.id),
    chosenLabel: text("chosen_label").notNull(),
    isCorrect: integer("is_correct", { mode: "boolean" }).notNull(),
    answeredAt: integer("answered_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check(
      "question_results_chosen_label_check",
      sql`${table.chosenLabel} in ('A', 'B', 'C', 'D')`,
    ),
    // Hot path: completion, history and review all filter/join question_results by session_id;
    // scoring joins back to questions by question_id.
    index("question_results_session_id_idx").on(table.sessionId),
    index("question_results_question_id_idx").on(table.questionId),
  ],
);

// spec: docs/specs/llm-enrichment.md §Data model changes
export const explanations = sqliteTable("explanations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .unique()
    .references(() => questions.id),
  correctReason: text("correct_reason").notNull(),
  optionAReason: text("option_a_reason").notNull(),
  optionBReason: text("option_b_reason").notNull(),
  optionCReason: text("option_c_reason").notNull(),
  optionDReason: text("option_d_reason").notNull(),
  generatedBy: text("generated_by").notNull(),
  generatedAt: integer("generated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// spec: docs/specs/writing-import.md §Data model changes
// The authored Writing task bank. Natural key (source_file, task_number) mirrors questions; a
// task_number (1–3) may have multiple candidates that the per-session draw selects from.
export const writingTasks = sqliteTable(
  "writing_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceFile: text("source_file").notNull(),
    taskNumber: integer("task_number").notNull(),
    title: text("title"),
    prompt: text("prompt").notNull(),
    instructions: text("instructions"),
    minWords: integer("min_words"),
    maxWords: integer("max_words"),
    sampleAnswer: text("sample_answer"),
    template: text("template"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique("writing_tasks_source_file_task_number_unique").on(
      table.sourceFile,
      table.taskNumber,
    ),
    check(
      "writing_tasks_task_number_check",
      sql`${table.taskNumber} between 1 and 3`,
    ),
    // Session creation filters/draws by task_number.
    index("writing_tasks_task_number_idx").on(table.taskNumber),
  ],
);

// spec: docs/specs/writing-session.md §Data model changes
// One free-text response per task per writing session (drafts autosaved; submitted_at set on submit).
export const writingResponses = sqliteTable(
  "writing_responses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    writingTaskId: integer("writing_task_id")
      .notNull()
      .references(() => writingTasks.id),
    taskNumber: integer("task_number").notNull(),
    responseText: text("response_text").notNull().default(""),
    wordCount: integer("word_count"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("writing_responses_session_task_unique").on(
      table.sessionId,
      table.taskNumber,
    ),
    check(
      "writing_responses_task_number_check",
      sql`${table.taskNumber} between 1 and 3`,
    ),
    index("writing_responses_session_id_idx").on(table.sessionId),
  ],
);

// spec: docs/specs/writing-evaluation.md §Data model changes
// Claude's score (0–20) + feedback for one response. The NCLC level is NOT stored — it is derived
// deterministically from `score` on read (writing-evaluation §Score → NCLC).
export const writingEvaluations = sqliteTable(
  "writing_evaluations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    responseId: integer("response_id")
      .notNull()
      .unique()
      .references(() => writingResponses.id),
    score: integer("score").notNull(),
    strengths: text("strengths").notNull(),
    errors: text("errors").notNull(),
    improvements: text("improvements").notNull(),
    generatedBy: text("generated_by").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check(
      "writing_evaluations_score_check",
      sql`${table.score} between 0 and 20`,
    ),
  ],
);

// spec: docs/specs/speaking-import.md §Data model changes
// The authored Speaking task bank. Natural key (source_file, sequence) mirrors questions; a
// task_number (1–3) may have multiple candidates (distinct sequences) that the per-session draw
// selects from. No correct answer — each task is a spoken prompt + optional sample answer.
export const speakingTasks = sqliteTable(
  "speaking_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceFile: text("source_file").notNull(),
    sequence: integer("sequence").notNull(),
    taskNumber: integer("task_number").notNull(),
    question: text("question").notNull(),
    sampleAnswer: text("sample_answer"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    unique("speaking_tasks_source_file_sequence_unique").on(
      table.sourceFile,
      table.sequence,
    ),
    check(
      "speaking_tasks_task_number_check",
      sql`${table.taskNumber} between 1 and 3`,
    ),
    // Session creation filters/draws by task_number.
    index("speaking_tasks_task_number_idx").on(table.taskNumber),
  ],
);

// spec: docs/specs/speaking-session.md §Data model changes
// One voice recording per task per speaking session: the saved audio path, its Whisper transcript,
// and the recording length. submitted_at is set on submit / session end.
export const speakingResponses = sqliteTable(
  "speaking_responses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    speakingTaskId: integer("speaking_task_id")
      .notNull()
      .references(() => speakingTasks.id),
    taskNumber: integer("task_number").notNull(),
    audioPath: text("audio_path"),
    transcript: text("transcript"),
    durationMs: integer("duration_ms"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("speaking_responses_session_task_unique").on(
      table.sessionId,
      table.taskNumber,
    ),
    check(
      "speaking_responses_task_number_check",
      sql`${table.taskNumber} between 1 and 3`,
    ),
    index("speaking_responses_session_id_idx").on(table.sessionId),
  ],
);

// spec: docs/specs/speaking-evaluation.md §Data model changes
// Claude's score (0–20) + feedback for one speaking response. The NCLC level is NOT stored — it is
// derived deterministically from `score` on read (shared with writing via server/lib/nclc.ts).
export const speakingEvaluations = sqliteTable(
  "speaking_evaluations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    responseId: integer("response_id")
      .notNull()
      .unique()
      .references(() => speakingResponses.id),
    score: integer("score").notNull(),
    strengths: text("strengths").notNull(),
    errors: text("errors").notNull(),
    improvements: text("improvements").notNull(),
    generatedBy: text("generated_by").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    check(
      "speaking_evaluations_score_check",
      sql`${table.score} between 0 and 20`,
    ),
  ],
);
