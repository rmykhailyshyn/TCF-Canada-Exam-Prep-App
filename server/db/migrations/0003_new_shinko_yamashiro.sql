CREATE TABLE "speaking_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"score" integer NOT NULL,
	"strengths" text NOT NULL,
	"errors" text NOT NULL,
	"improvements" text NOT NULL,
	"generated_by" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_evaluations_response_id_unique" UNIQUE("response_id"),
	CONSTRAINT "speaking_evaluations_score_check" CHECK ("speaking_evaluations"."score" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "speaking_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"speaking_task_id" integer NOT NULL,
	"task_number" integer NOT NULL,
	"audio_path" text,
	"transcript" text,
	"duration_ms" integer,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "speaking_responses_session_task_unique" UNIQUE("session_id","task_number"),
	CONSTRAINT "speaking_responses_task_number_check" CHECK ("speaking_responses"."task_number" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "speaking_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_file" text NOT NULL,
	"sequence" integer NOT NULL,
	"task_number" integer NOT NULL,
	"question" text NOT NULL,
	"sample_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "speaking_tasks_source_file_sequence_unique" UNIQUE("source_file","sequence"),
	CONSTRAINT "speaking_tasks_task_number_check" CHECK ("speaking_tasks"."task_number" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_section_check";--> statement-breakpoint
ALTER TABLE "speaking_evaluations" ADD CONSTRAINT "speaking_evaluations_response_id_speaking_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."speaking_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_responses" ADD CONSTRAINT "speaking_responses_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaking_responses" ADD CONSTRAINT "speaking_responses_speaking_task_id_speaking_tasks_id_fk" FOREIGN KEY ("speaking_task_id") REFERENCES "public"."speaking_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaking_responses_session_id_idx" ON "speaking_responses" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "speaking_tasks_task_number_idx" ON "speaking_tasks" USING btree ("task_number");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_section_check" CHECK ("sessions"."section" in ('reading', 'listening', 'writing', 'speaking'));