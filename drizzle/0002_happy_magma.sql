CREATE TYPE "public"."pronunciation_confidence" AS ENUM('high', 'medium', 'low', 'unavailable');--> statement-breakpoint
ALTER TYPE "public"."api_route" ADD VALUE 'model_answer';--> statement-breakpoint
ALTER TABLE "mistakes" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."mistake_category";--> statement-breakpoint
CREATE TYPE "public"."mistake_category" AS ENUM('article', 'preposition', 'countability', 'agreement', 'tense', 'word_choice', 'collocation', 'repetition', 'fluency', 'other');--> statement-breakpoint
ALTER TABLE "mistakes" ALTER COLUMN "category" SET DATA TYPE "public"."mistake_category" USING "category"::"public"."mistake_category";--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "pronunciation_est" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "pronunciation_confidence" "pronunciation_confidence" NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "guardrails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "prompt_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "model" text NOT NULL;