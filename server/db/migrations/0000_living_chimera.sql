CREATE TABLE `audio_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`duration_ms` integer,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_files_question_id_unique` ON `audio_files` (`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audio_files_file_path_unique` ON `audio_files` (`file_path`);--> statement-breakpoint
CREATE TABLE `explanations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`correct_reason` text NOT NULL,
	`option_a_reason` text NOT NULL,
	`option_b_reason` text NOT NULL,
	`option_c_reason` text NOT NULL,
	`option_d_reason` text NOT NULL,
	`generated_by` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `explanations_question_id_unique` ON `explanations` (`question_id`);--> statement-breakpoint
CREATE TABLE `options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`label` text NOT NULL,
	`text` text NOT NULL,
	`is_correct` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "options_label_check" CHECK("options"."label" in ('A', 'B', 'C', 'D'))
);
--> statement-breakpoint
CREATE INDEX `options_question_id_idx` ON `options` (`question_id`);--> statement-breakpoint
CREATE TABLE `passages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_file` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passages_source_file_unique` ON `passages` (`source_file`);--> statement-breakpoint
CREATE TABLE `question_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`chosen_label` text NOT NULL,
	`is_correct` integer NOT NULL,
	`answered_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "question_results_chosen_label_check" CHECK("question_results"."chosen_label" in ('A', 'B', 'C', 'D'))
);
--> statement-breakpoint
CREATE INDEX `question_results_session_id_idx` ON `question_results` (`session_id`);--> statement-breakpoint
CREATE INDEX `question_results_question_id_idx` ON `question_results` (`question_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`passage_id` integer,
	`source_file` text NOT NULL,
	`sequence` integer NOT NULL,
	`text` text NOT NULL,
	`section` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`passage_id`) REFERENCES `passages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "questions_section_check" CHECK("questions"."section" in ('reading', 'listening'))
);
--> statement-breakpoint
CREATE INDEX `questions_section_idx` ON `questions` (`section`);--> statement-breakpoint
CREATE INDEX `questions_passage_id_idx` ON `questions` (`passage_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `questions_source_file_sequence_unique` ON `questions` (`source_file`,`sequence`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section` text NOT NULL,
	`mode` text NOT NULL,
	`difficulty` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	`elapsed_ms` integer,
	CONSTRAINT "sessions_section_check" CHECK("sessions"."section" in ('reading', 'listening', 'writing', 'speaking')),
	CONSTRAINT "sessions_mode_check" CHECK("sessions"."mode" in ('learning', 'real')),
	CONSTRAINT "sessions_difficulty_check" CHECK("sessions"."difficulty" is null or "sessions"."difficulty" in ('beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'expert'))
);
--> statement-breakpoint
CREATE TABLE `speaking_evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`response_id` integer NOT NULL,
	`score` integer NOT NULL,
	`strengths` text NOT NULL,
	`errors` text NOT NULL,
	`improvements` text NOT NULL,
	`generated_by` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `speaking_responses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "speaking_evaluations_score_check" CHECK("speaking_evaluations"."score" between 0 and 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speaking_evaluations_response_id_unique` ON `speaking_evaluations` (`response_id`);--> statement-breakpoint
CREATE TABLE `speaking_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`speaking_task_id` integer NOT NULL,
	`task_number` integer NOT NULL,
	`audio_path` text,
	`transcript` text,
	`duration_ms` integer,
	`submitted_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaking_task_id`) REFERENCES `speaking_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "speaking_responses_task_number_check" CHECK("speaking_responses"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE INDEX `speaking_responses_session_id_idx` ON `speaking_responses` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `speaking_responses_session_task_unique` ON `speaking_responses` (`session_id`,`task_number`);--> statement-breakpoint
CREATE TABLE `speaking_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_file` text NOT NULL,
	`sequence` integer NOT NULL,
	`task_number` integer NOT NULL,
	`question` text NOT NULL,
	`sample_answer` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "speaking_tasks_task_number_check" CHECK("speaking_tasks"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE INDEX `speaking_tasks_task_number_idx` ON `speaking_tasks` (`task_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `speaking_tasks_source_file_sequence_unique` ON `speaking_tasks` (`source_file`,`sequence`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`text` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `transcript_segments_question_id_idx` ON `transcript_segments` (`question_id`);--> statement-breakpoint
CREATE TABLE `writing_evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`response_id` integer NOT NULL,
	`score` integer NOT NULL,
	`strengths` text NOT NULL,
	`errors` text NOT NULL,
	`improvements` text NOT NULL,
	`generated_by` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`response_id`) REFERENCES `writing_responses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "writing_evaluations_score_check" CHECK("writing_evaluations"."score" between 0 and 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `writing_evaluations_response_id_unique` ON `writing_evaluations` (`response_id`);--> statement-breakpoint
CREATE TABLE `writing_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`writing_task_id` integer NOT NULL,
	`task_number` integer NOT NULL,
	`response_text` text DEFAULT '' NOT NULL,
	`word_count` integer,
	`submitted_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`writing_task_id`) REFERENCES `writing_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "writing_responses_task_number_check" CHECK("writing_responses"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE INDEX `writing_responses_session_id_idx` ON `writing_responses` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `writing_responses_session_task_unique` ON `writing_responses` (`session_id`,`task_number`);--> statement-breakpoint
CREATE TABLE `writing_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_file` text NOT NULL,
	`task_number` integer NOT NULL,
	`title` text,
	`prompt` text NOT NULL,
	`instructions` text,
	`min_words` integer,
	`max_words` integer,
	`sample_answer` text,
	`template` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "writing_tasks_task_number_check" CHECK("writing_tasks"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE INDEX `writing_tasks_task_number_idx` ON `writing_tasks` (`task_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `writing_tasks_source_file_task_number_unique` ON `writing_tasks` (`source_file`,`task_number`);