import { notFound, redirect } from "next/navigation";
import { apiServer } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import Header from "../../header";
import ProfileView, { type Profile } from "./profile-view";

export default async function ProfilePage(props: PageProps<"/u/[username]">) {
  const { username } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await apiServer<Profile>(
    `/profiles/${encodeURIComponent(username)}`
  );
  if (!profile) notFound();

  const own = profile.id === user.id;
  // The public profile omits the leaderboard flag; own settings read /me.
  const me = own
    ? await apiServer<{ leaderboard_opt_in: boolean }>("/me")
    : null;
  return (
    <main className="flex flex-1 flex-col">
      <Header kicker={own ? "Your profile" : "Profile"} />
      <ProfileView
        profile={profile}
        viewerId={user.id}
        email={own ? (user.email ?? "") : null}
        leaderboardOptIn={me?.leaderboard_opt_in ?? true}
      />
    </main>
  );
}
