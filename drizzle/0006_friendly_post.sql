CREATE TABLE "guest_usage" (
	"subject" text NOT NULL,
	"day" date NOT NULL,
	"endpoint" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guest_usage_subject_day_endpoint_pk" PRIMARY KEY("subject","day","endpoint")
);
--> statement-breakpoint
CREATE INDEX "guest_usage_day_idx" ON "guest_usage" USING btree ("day");