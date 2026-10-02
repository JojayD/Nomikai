"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";
import EntryCard, { type EntryRowData } from "../../entry-card";
import AccountPanel from "../../account-panel";

const PAGE_SIZE = 30;

export type Profile = {
  id: string;
  username: string;
  avatar_url: string | null;
  avatar_src: string | null; // signed by the API
  user_code: string;
  timezone: string;
};

export default function ProfileView({
  profile,
  viewerId,
  email,
  leaderboardOptIn,
}: {
  profile: Profile;
  viewerId: string;
  email: string | null; // non-null only on the own profile
  leaderboardOptIn: boolean;
}) {
  const own = profile.id === viewerId;
  const queryClient = useQueryClient();

  const friendship = useQuery({
    queryKey: ["friendship", profile.id],
    enabled: !own,
    queryFn: () =>
      api<{ id: string; requester_id: string; status: string } | null>(
        `/friendships/with/${profile.id}`
      ),
  });

  // F10: block state; blocking dissolved any friendship server-side.
  const blocks = useQuery({
    queryKey: ["blocks"],
    enabled: !own,
    queryFn: () => api<{ blocked_id: string }[]>("/blocks"),
  });
  const blocked = !!blocks.data?.some((b) => b.blocked_id === profile.id);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const toggleBlock = useMutation({
    mutationFn: () =>
      blocked
        ? api(`/blocks/${profile.id}`, { method: "DELETE" })
        : api("/blocks", { method: "POST", ...json({ blocked_id: profile.id }) }),
    onSuccess: () => {
      setConfirmBlock(false);
      queryClient.invalidateQueries();
    },
  });
  const state = own
    ? "self"
    : friendship.data == null
      ? "none"
      : friendship.data.status === "accepted"
        ? "friends"
        : friendship.data.requester_id === viewerId
          ? "pending-out"
          : "pending-in";
  const canSee = own || state === "friends";

  const stats = useQuery({
    queryKey: ["stats", profile.id],
    enabled: canSee,
    queryFn: () =>
      api<{
        total_entries: number;
        unique_drinks: number;
        nights_out: number;
      }>(`/profiles/${profile.id}/stats`),
  });

  const entries = useInfiniteQuery({
    queryKey: ["entries", profile.id],
    enabled: canSee,
    initialPageParam: 0,
    // The API orders, gates on friendship, and signs the photo URLs.
    queryFn: ({ pageParam }) =>
      api<EntryRowData[]>(
        `/entries?user_id=${profile.id}&limit=${PAGE_SIZE}&offset=${pageParam}`
      ),
    getNextPageParam: (last, _all, lastOffset) =>
      last.length < PAGE_SIZE ? null : lastOffset + PAGE_SIZE,
  });

  // Send / accept / withdraw all land here; visibility changes with them,
  // so refetch everything rather than tracking which keys are affected.
  const sendRequest = useMutation({
    mutationFn: () =>
      api("/friendships", {
        method: "POST",
        ...json({ addressee_id: profile.id }),
      }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const accept = useMutation({
    mutationFn: () =>
      api(`/friendships/${friendship.data!.id}`, { method: "PATCH" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const withdraw = useMutation({
    mutationFn: () =>
      api(`/friendships/${friendship.data!.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const busy = sendRequest.isPending || accept.isPending || withdraw.isPending;

  return (
    <>
      <div className="px-4 py-5">
        <div className="flex items-center gap-3">
          {profile.avatar_src && (
            // eslint-disable-next-line @next/next/no-img-element -- signed URL, remote patterns don't apply
            <img src={profile.avatar_src} alt="" className="h-14 w-14 object-cover" />
          )}
          <div>
            <h2 className="text-[26px] tracking-[-0.03em]">
              @{profile.username}
            </h2>
            {state === "friends" && <span className="kicker">Friends</span>}
          </div>
        </div>

        {!own && state !== "friends" && !blocked && (
          <div className="mt-4">
            {state === "none" && (
              <button
                className="btn btn-primary btn-block !mt-0"
                disabled={busy || friendship.isPending}
                onClick={() => sendRequest.mutate()}
              >
                Add friend
              </button>
            )}
            {state === "pending-out" && (
              <button
                className="btn btn-secondary btn-block !mt-0"
                disabled={busy}
                onClick={() => withdraw.mutate()}
              >
                Request sent · tap to cancel
              </button>
            )}
            {state === "pending-in" && (
              <>
                <button
                  className="btn btn-primary btn-block !mt-0"
                  disabled={busy}
                  onClick={() => accept.mutate()}
                >
                  Accept friend request
                </button>
                <button
                  className="btn btn-secondary btn-block"
                  disabled={busy}
                  onClick={() => withdraw.mutate()}
                >
                  Decline
                </button>
              </>
            )}
            <p className="mt-3 text-[13.5px] opacity-70">
              Drinks and stats are visible to friends only.
            </p>
          </div>
        )}

        {!own && !blocks.isPending && (
          <div className="mt-4">
            {blocked && (
              <p className="mb-2 text-[13.5px] opacity-70">
                Blocked — you can&apos;t see each other&apos;s drinks, and
                neither of you can send a friend request.
              </p>
            )}
            <button
              className="btn btn-ghost !mt-0 text-sm"
              style={{ color: "var(--color-accent)" }}
              disabled={toggleBlock.isPending}
              onClick={() => {
                if (blocked || confirmBlock) return toggleBlock.mutate();
                setConfirmBlock(true);
              }}
            >
              {blocked
                ? "Unblock"
                : confirmBlock
                  ? "Tap again to block & unfriend"
                  : `Block @${profile.username}`}
            </button>
          </div>
        )}

        {canSee && stats.data && (
          <div
            className="mt-4 grid grid-cols-3 border"
            style={{ borderColor: "var(--color-divider)" }}
          >
            {(
              [
                [stats.data.total_entries, "Entries"],
                [stats.data.unique_drinks, "Unique drinks"],
                [stats.data.nights_out, "Nights out"],
              ] as const
            ).map(([n, label], i) => (
              <div
                key={label}
                className={`px-3.5 py-3 ${i < 2 ? "border-r" : ""}`}
                style={{ borderColor: "var(--color-divider)" }}
              >
                <div className="font-extrabold text-[26px] tabular-nums">
                  {n}
                </div>
                <div className="kicker">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canSee && (
        <div>
          {entries.data?.pages.flat().map((r) => (
            <EntryCard
              key={r.id}
              row={r}
              editHref={own ? `/log?id=${r.id}` : undefined}
              nightHref={
                own && r.night_out_id ? `/nights/${r.night_out_id}` : undefined
              }
            />
          ))}
          {entries.hasNextPage && (
            <div className="px-4 py-3">
              <button
                className="btn btn-secondary btn-block !mt-0"
                disabled={entries.isFetchingNextPage}
                onClick={() => entries.fetchNextPage()}
              >
                {entries.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}

      {own && email !== null && (
        <AccountPanel
          username={profile.username}
          userCode={profile.user_code}
          timezone={profile.timezone}
          email={email}
          avatarUrl={profile.avatar_url}
          leaderboardOptIn={leaderboardOptIn}
        />
      )}
    </>
  );
}
