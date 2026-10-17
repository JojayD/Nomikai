import Link from "next/link";
import { redirect } from "next/navigation";
import { apiServer } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import Header from "./header";
import Feed from "./feed";
import Avatar from "./avatar";

export default async function Home(props: PageProps<"/">) {
  // Email-link redirects can land on "/" when the redirect allow-list falls
  // back to the site URL; hand the code to the confirm route.
  const { code } = await props.searchParams;
  if (typeof code === "string") redirect(`/auth/confirm?code=${code}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await apiServer<{
    username: string;
    avatar_src: string | null;
  } | null>("/me");
  if (!profile) redirect("/onboarding");

  return (
    <main className="feed-home flex flex-1 flex-col">
      <div className="feed-mobile-header">
        <Header
          right={
            <nav className="flex items-baseline gap-3 text-sm font-extrabold">
              <Link href="/log" className="!text-[inherit] no-underline">
                Log
              </Link>
              <Link href="/board" className="!text-[inherit] no-underline">
                Board
              </Link>
              <Link href="/friends" className="!text-[inherit] no-underline">
                Friends
              </Link>
              <Link
                href={`/u/${profile.username}`}
                className="flex items-center gap-1.5 !text-[inherit] no-underline"
              >
                <Avatar
                  src={profile.avatar_src}
                  username={profile.username}
                  size={5}
                />
                @{profile.username}
              </Link>
            </nav>
          }
        />
      </div>
      <section className="feed-timeline" aria-label="Drink logs">
        <Link href="/collection" className="block border-b border-[var(--color-divider)] px-4 py-3 text-sm font-bold lg:mb-6 lg:px-0">
          My collection · Want to try &amp; Passport
        </Link>
        <div className="feed-title hidden">
          <div>
            <h1 className="text-2xl">Drink logs</h1>
            <p className="mt-1 text-sm opacity-60">
              Your drinks. Your friends. Good nights.
            </p>
          </div>
          <Link href="/log" className="btn btn-primary">
            Log a drink
          </Link>
        </div>
        <Feed viewerId={user.id} />
      </section>
      <aside className="feed-profile hidden" aria-label="Your profile">
        <Link
          href={`/u/${profile.username}`}
          className="flex items-center gap-3 !text-[inherit] no-underline"
        >
          <Avatar
            src={profile.avatar_src}
            username={profile.username}
            size={14}
          />
          <div className="min-w-0">
            <p className="truncate font-extrabold">@{profile.username}</p>
            <p className="text-sm opacity-60">View your profile</p>
          </div>
        </Link>
        <div className="mt-8 border-t border-[var(--color-divider)] pt-6">
          <h3 className="text-base">Better with friends.</h3>
          <p className="mt-2 text-sm opacity-70">
            Invite your people and keep up with what they’re drinking.
          </p>
          <Link href="/friends" className="btn btn-ghost mt-3 text-sm">
            Find friends
          </Link>
        </div>
        <p className="mt-10 text-xs opacity-45">
          Nomikai · Make a night of it.
        </p>
      </aside>
    </main>
  );
}
