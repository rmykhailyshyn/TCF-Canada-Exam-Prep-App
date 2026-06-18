CREATE TABLE "writing_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"score" integer NOT NULL,
	"strengths" text NOT NULL,
	"errors" text NOT NULL,
	"improvements" text NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writing_evaluations_response_id_unique" UNIQUE("response_id"),
	CONSTRAINT "writing_evaluations_score_check" CHECK ("writing_evaluations"."score" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "writing_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"writing_task_id" integer NOT NULL,
	"task_number" integer NOT NULL,
	"response_text" text DEFAULT '' NOT NULL,
	"word_count" integer,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "writing_responses_session_task_unique" UNIQUE("session_id","task_number"),
	CONSTRAINT "writing_responses_task_number_check" CHECK ("writing_responses"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "writing_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"task_number" integer NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"instructions" text,
	"min_words" integer,
	"max_words" integer,
	"sample_answer" text,
	"template" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writing_tasks_source_file_task_number_unique" UNIQUE("source_file","task_number"),
	CONSTRAINT "writing_tasks_task_number_check" CHECK ("writing_tasks"."task_number" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_section_check";--> statement-breakpoint
ALTER TABLE "writing_evaluations" ADD CONSTRAINT "writing_evaluations_response_id_writing_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."writing_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_responses" ADD CONSTRAINT "writing_responses_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_responses" ADD CONSTRAINT "writing_responses_writing_task_id_writing_tasks_id_fk" FOREIGN KEY ("writing_task_id") REFERENCES "public"."writing_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "writing_responses_session_id_idx" ON "writing_responses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "writing_tasks_task_number_idx" ON "writing_tasks" USING btree ("task_number");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_section_check" CHECK ("sessions"."section" in ('reading', 'listening', 'writing'));