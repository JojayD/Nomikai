"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";

type BoardRow = {
  id: string;
  username: string;
  avatar_src: string | null;
  unique_drinks: number;
  nights_out: number;
};

/**
 * F9: ranked on exploration — unique drinks first, nights out second. The API
 * scopes rows to the viewer plus their opted-in mutual friends, so a solo (or
 * opted-out) viewer sees exactly one row: themselves.
 */
export default function Board({ viewerId }: { viewerId: string }) {
  const [window, setWindow] = useState<"week" | "month">("week");
  const board = useQuery({
    queryKey: ["leaderboard", window],
    queryFn: () => api<BoardRow[]>(`/leaderboard?window=${window}`),
  });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-baseline gap-2 px-4 pt-4">
        {(["week", "month"] as const).map((w) => (
          <button
            key={w}
            className={`btn !mt-0 text-sm ${window === w ? "btn-primary" : "btn-secondary"}`}
            onClick={() => setWindow(w)}
          >
            {w === "week" ? "This week" : "This month"}
          </button>
        ))}
        <Link href="/recap" className="kicker ml-auto">
          Weekly recap →
        </Link>
      </div>

      {board.isPending ? (
        <div className="kicker px-4 py-7">Loading…</div>
      ) : board.isError ? (
        <p
          className="px-4 py-7 text-sm font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          Could not load the leaderboard.
        </p>
      ) : (
        <div className="mt-4">
          {board.data.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 border-b px-4 py-3"
              style={{
                borderColor: "var(--color-divider)",
                ...(r.id === viewerId && {
                  background: "var(--color-divider)",
                }),
              }}
            >
              <span className="w-6 text-[17px] font-extrabold tabular-nums">
                {i + 1}
              </span>
              {r.avatar_src && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, remote patterns don't apply
                <img
                  src={r.avatar_src}
                  alt=""
                  className="h-7 w-7 object-cover"
                />
              )}
              <Link
                href={`/u/${r.username}`}
                className="mr-auto text-sm font-extrabold !text-[inherit] no-underline"
              >
                @{r.username}
              </Link>
              <span className="text-sm tabular-nums">
                <b>{r.unique_drinks}</b> drinks
              </span>
              <span className="text-sm tabular-nums opacity-70">
                {r.nights_out} nights
              </span>
            </div>
          ))}
          {board.data.length === 1 && (
            <p className="px-4 py-4 text-[13.5px] opacity-70">
              Just you so far — add friends to have someone to beat, or check
              your leaderboard setting on your profile.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
