CREATE INDEX "options_question_id_idx" ON "options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_results_session_id_idx" ON "question_results" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "question_results_question_id_idx" ON "question_results" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "questions_section_idx" ON "questions" USING btree ("section");--> statement-breakpoint
CREATE INDEX "questions_passage_id_idx" ON "questions" USING btree ("passage_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_question_id_idx" ON "transcript_segments" USING btree ("question_id");