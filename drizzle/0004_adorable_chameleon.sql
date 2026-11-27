CREATE TYPE "public"."rate_window" AS ENUM('day', 'minute');--> statement-breakpoint
CREATE TABLE "rate_buckets" (
	"user_id" uuid NOT NULL,
	"kind" "rate_window" NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_buckets_user_id_kind_bucket_start_pk" PRIMARY KEY("user_id","kind","bucket_start")
);
--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "client_token" text;--> statement-breakpoint
ALTER TABLE "rate_buckets" ADD CONSTRAINT "rate_buckets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_buckets_started_idx" ON "rate_buckets" USING btree ("bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_user_client_token_idx" ON "answers" USING btree ("user_id","client_token") WHERE "answers"."client_token" is not null;