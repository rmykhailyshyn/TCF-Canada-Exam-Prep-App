CREATE TABLE "audio_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"duration_ms" integer,
	CONSTRAINT "audio_files_question_id_unique" UNIQUE("question_id"),
	CONSTRAINT "audio_files_file_path_unique" UNIQUE("file_path")
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"correct_reason" text NOT NULL,
	"option_a_reason" text NOT NULL,
	"option_b_reason" text NOT NULL,
	"option_c_reason" text NOT NULL,
	"option_d_reason" text NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explanations_question_id_unique" UNIQUE("question_id")
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"label" text NOT NULL,
	"text" text NOT NULL,
	"is_correct" boolean NOT NULL,
	CONSTRAINT "options_label_check" CHECK ("options"."label" in ('A', 'B', 'C', 'D'))
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passages_source_file_unique" UNIQUE("source_file")
);
--> statement-breakpoint
CREATE TABLE "question_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"chosen_label" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_results_chosen_label_check" CHECK ("question_results"."chosen_label" in ('A', 'B', 'C', 'D'))
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"passage_id" integer,
	"source_file" text NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"section" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_source_file_sequence_unique" UNIQUE("source_file","sequence"),
	CONSTRAINT "questions_section_check" CHECK ("questions"."section" in ('reading', 'listening'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"mode" text NOT NULL,
	"difficulty" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"elapsed_ms" integer,
	CONSTRAINT "sessions_section_check" CHECK ("sessions"."section" in ('reading', 'listening')),
	CONSTRAINT "sessions_mode_check" CHECK ("sessions"."mode" in ('learning', 'real')),
	CONSTRAINT "sessions_difficulty_check" CHECK ("sessions"."difficulty" is null or "sessions"."difficulty" in ('beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced', 'expert'))
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_id" integer NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_results" ADD CONSTRAINT "question_results_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE no action ON UPDATE no action;