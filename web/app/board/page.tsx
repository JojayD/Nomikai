import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Header from "../header";
import Board from "./board";

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="desktop-page board-page flex flex-1 flex-col">
      <Header kicker="Leaderboard" />
      <Board viewerId={user.id} />
    </main>
  );
}
