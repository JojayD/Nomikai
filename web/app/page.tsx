import Link from "next/link";
import { redirect } from "next/navigation";
import { apiServer } from "@/lib/api-server";
import { createClient } from "@/lib/supabase/server";
import Header from "./header";
import Feed from "./feed";

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

  const profile = await apiServer<{ username: string } | null>("/me");
  if (!profile) redirect("/onboarding");

  return (
    <main className="flex flex-1 flex-col">
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
              className="!text-[inherit] no-underline"
            >
              @{profile.username}
            </Link>
          </nav>
        }
      />
      <Feed viewerId={user.id} />
    </main>
  );
}
