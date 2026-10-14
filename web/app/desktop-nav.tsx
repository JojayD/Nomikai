"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Avatar from "./avatar";

export default function DesktopNav() {
  const pathname = usePathname();
  const inApp = ["/", "/log", "/board", "/friends", "/collection", "/recap"].includes(pathname)
    || pathname.startsWith("/u/") || pathname.startsWith("/nights/");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ username: string; avatar_src: string | null } | null>("/me"),
    enabled: inApp,
    staleTime: Infinity,
  });
  const profile = me.data;

  if (!inApp) return null;

  return (
    <aside className="desktop-nav hidden">
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
            aria-current={pathname === href ? "page" : undefined}
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
      {profile && (
        <Link
          href={`/u/${profile.username}`}
          aria-current={pathname === `/u/${profile.username}` ? "page" : undefined}
          className="feed-nav-link mt-auto"
        >
          <Avatar src={profile.avatar_src} username={profile.username} size={7} />
          <span className="min-w-0 truncate">@{profile.username}</span>
        </Link>
      )}
    </aside>
  );
}
