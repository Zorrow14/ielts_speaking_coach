DROP INDEX "mistakes_user_pair_idx";--> statement-breakpoint
CREATE INDEX "mistakes_user_pair_folded_idx" ON "mistakes" USING btree ("user_id",lower(btrim("original")),lower(btrim("correction")));