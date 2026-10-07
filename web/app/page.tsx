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
      <aside className="feed-nav hidden">
        <Link href="/" className="feed-brand">
          NOMIKAI
        </Link>
        <nav aria-label="Main navigation" className="flex flex-col gap-2">
          {[
            {
              href: "/",
              label: "Home",
              icon: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
            },
            {
              href: "/log",
              label: "Log a drink",
              icon: "M12 5v14M5 12h14M3 3h18v18H3Z",
            },
            {
              href: "/board",
              label: "Leaderboard",
              icon: "M4 21V11h5v10M9 21V3h6v18M15 21V7h5v14",
            },
            {
              href: "/friends",
              label: "Friends",
              icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
            },
            {
              href: "/collection",
              label: "My collection",
              icon: "M4 3h16v18H4ZM8 8h8M8 12h8M8 16h5",
            },
            {
              href: "/recap",
              label: "Weekly recap",
              icon: "M4 3h16v18H4ZM8 8h8M8 12h8M8 16h5",
            },
          ].map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={href === "/" ? "page" : undefined}
              className="feed-nav-link"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={icon} />
              </svg>
              {label}
            </Link>
          ))}
        </nav>
        <Link href={`/u/${profile.username}`} className="feed-nav-link mt-auto">
          <Avatar
            src={profile.avatar_src}
            username={profile.username}
            size={7}
          />
          <span className="min-w-0 truncate">@{profile.username}</span>
        </Link>
      </aside>
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
        <Link href="/collection" className="border-b border-[var(--color-divider)] px-4 py-3 text-sm font-bold">
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
