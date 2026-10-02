CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "blocks_check" CHECK (blocker_id <> blocked_id)
);

ALTER TABLE "blocks" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "reactions" (
	"entry_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_pkey" PRIMARY KEY("entry_id","user_id")
);

ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "public"."entries"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
CREATE POLICY "own blocks select" ON "blocks" AS PERMISSIVE FOR SELECT TO public USING ((select auth.uid()) = blocker_id);
CREATE POLICY "own blocks insert" ON "blocks" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((select auth.uid()) = blocker_id);
CREATE POLICY "own blocks delete" ON "blocks" AS PERMISSIVE FOR DELETE TO public USING ((select auth.uid()) = blocker_id);
CREATE POLICY "reactions on visible entries select" ON "reactions" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from public.entries e where e.id = entry_id
        and ((select auth.uid()) = e.user_id or public.is_friends_with(e.user_id))));
CREATE POLICY "own reactions insert" ON "reactions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ((select auth.uid()) = user_id and exists (
        select 1 from public.entries e where e.id = entry_id
        and ((select auth.uid()) = e.user_id or public.is_friends_with(e.user_id))));
CREATE POLICY "own reactions delete" ON "reactions" AS PERMISSIVE FOR DELETE TO public USING ((select auth.uid()) = user_id);
-- Explicit grants (see drinks migration note): default ACLs give client roles
-- nothing on postgres-created tables; RLS alone means 42501.
grant select, insert, delete on public.reactions to authenticated;
grant select, insert, delete on public.blocks to authenticated;
