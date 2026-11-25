ALTER TABLE "entries" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_rating_check" CHECK (rating between 1 and 3);