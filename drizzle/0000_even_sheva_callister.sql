CREATE TYPE "public"."mistake_category" AS ENUM('grammar', 'vocab', 'fluency');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"transcript" text NOT NULL,
	"duration_sec" integer,
	"word_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"fluency" numeric(2, 1) NOT NULL,
	"lexical" numeric(2, 1) NOT NULL,
	"grammar" numeric(2, 1) NOT NULL,
	"pronunciation_est" numeric(2, 1) NOT NULL,
	"overall" numeric(2, 1) NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "mistake_category" NOT NULL,
	"original" text NOT NULL,
	"correction" text NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"part" smallint NOT NULL,
	"topic" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_part_valid" CHECK ("sessions"."part" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocab_notebook" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phrase" text NOT NULL,
	"meaning" text,
	"example" text,
	"source_answer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_notebook" ADD CONSTRAINT "vocab_notebook_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_notebook" ADD CONSTRAINT "vocab_notebook_source_answer_id_answers_id_fk" FOREIGN KEY ("source_answer_id") REFERENCES "public"."answers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_session_idx" ON "answers" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "answers_user_created_idx" ON "answers" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_answer_idx" ON "feedback" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "feedback_user_created_idx" ON "feedback" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "mistakes_answer_idx" ON "mistakes" USING btree ("answer_id");--> statement-breakpoint
CREATE INDEX "mistakes_user_category_idx" ON "mistakes" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "sessions_user_started_idx" ON "sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vocab_user_created_idx" ON "vocab_notebook" USING btree ("user_id","created_at");