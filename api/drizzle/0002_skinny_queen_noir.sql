CREATE TABLE "saved_drinks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_drinks_user_name_key" UNIQUE("user_id","normalized_name"),
	CONSTRAINT "saved_drinks_name_check" CHECK (char_length(name) between 1 and 120 and char_length(normalized_name) > 0)
);
--> statement-breakpoint
ALTER TABLE "saved_drinks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_drinks" ADD CONSTRAINT "saved_drinks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_user_drink_idx" ON "entries" USING btree ("user_id","normalized_drink_name");