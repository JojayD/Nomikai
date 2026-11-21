CREATE TABLE "bar_menu_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bar_menu_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bar_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text GENERATED ALWAYS AS (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) STORED NOT NULL,
	"is_alcoholic" boolean NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "bar_menu_items_bar_name_key" UNIQUE("bar_id","normalized_name"),
	CONSTRAINT "bar_menu_items_name_check" CHECK (char_length(name) between 1 and 120 and char_length(normalized_name) > 0),
	CONSTRAINT "bar_menu_items_category_check" CHECK (category in ('beer', 'wine', 'spirit', 'cocktail', 'shot', 'non_alcoholic', 'other'))
);
--> statement-breakpoint
ALTER TABLE "bar_menu_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bar_menus" (
	"bar_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source_urls" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "bar_menus_status_check" CHECK (status in ('pending', 'ready', 'none')),
	CONSTRAINT "bar_menus_cited_check" CHECK (status <> 'ready' or cardinality(source_urls) >= 1)
);
--> statement-breakpoint
ALTER TABLE "bar_menus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bar_menu_items" ADD CONSTRAINT "bar_menu_items_bar_id_bar_menus_bar_id_fk" FOREIGN KEY ("bar_id") REFERENCES "public"."bar_menus"("bar_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- API-only tables: nothing for PostgREST to read or write.
revoke all on public.bar_menus, public.bar_menu_items from anon, authenticated;
