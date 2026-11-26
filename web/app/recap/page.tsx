import { redirect } from "next/navigation";
import { apiServer } from "@/lib/api-server";
import { type Recap, weekLabel } from "@/lib/recap";
import { createClient } from "@/lib/supabase/server";
import Header from "../header";
import ShareRecap from "./share-recap";

/** F8: the current week's stats, computed on read; /recap/image renders the shareable card. */
export default async function RecapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const recap = await apiServer<Recap>("/recap");
  if (!recap?.username) redirect("/onboarding");

  const stats = [
    [recap.nights_out, "Nights out"],
    [recap.unique_drinks, "Unique drinks"],
    [recap.total_entries, "Entries"],
  ] as const;

  return (
    <main className="desktop-page recap-page flex flex-1 flex-col">
      <Header kicker="Weekly recap" />
      <div className="px-4 py-5">
        <h2 className="text-26 tracking-[-0.03em]">
          Week of {weekLabel(recap)}
        </h2>
        <div
          className="mt-4 grid grid-cols-3 rounded-sm border border-divider"
        >
          {stats.map(([n, label], i) => (
            <div
              key={label}
              className={`border-divider px-3.5 py-3 ${i < 2 ? "border-r" : ""}`}
            >
              <div className="text-26 font-extrabold tabular-nums">{n}</div>
              <div className="kicker">{label}</div>
            </div>
          ))}
        </div>
        {recap.most_reacted && (
          <p className="mt-3 text-13">
            Most loved: <b>{recap.most_reacted.drink_name}</b> ·{" "}
            {recap.most_reacted.reactions} ♥
          </p>
        )}
        {recap.total_entries === 0 ? (
          <p className="mt-4 text-13 opacity-70">
            Nothing logged yet this week — the card fills in as you log.
          </p>
        ) : (
          <ShareRecap />
        )}
      </div>
    </main>
  );
}
