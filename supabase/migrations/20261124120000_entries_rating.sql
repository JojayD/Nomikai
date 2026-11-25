-- Three-state rating replaces the recommended boolean: 1 = not recommended,
-- 2 = meh, 3 = recommended. `recommended` stays until the code that reads it
-- is gone from production; a follow-up migration backfills stragglers and drops it.
ALTER TABLE "entries" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_rating_check" CHECK (rating between 1 and 3);--> statement-breakpoint
UPDATE "entries" SET "rating" = CASE WHEN "recommended" THEN 3 ELSE 1 END WHERE "recommended" IS NOT NULL;
