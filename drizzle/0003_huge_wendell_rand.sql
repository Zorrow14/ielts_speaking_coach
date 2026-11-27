ALTER TABLE "vocab_notebook" ADD COLUMN "next_review" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vocab_notebook" ADD COLUMN "interval_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vocab_notebook" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "mistakes_user_created_idx" ON "mistakes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mistakes_user_pair_idx" ON "mistakes" USING btree ("user_id","original","correction");--> statement-breakpoint
CREATE INDEX "sessions_user_part_idx" ON "sessions" USING btree ("user_id","part");--> statement-breakpoint
CREATE INDEX "vocab_user_next_review_idx" ON "vocab_notebook" USING btree ("user_id","next_review");