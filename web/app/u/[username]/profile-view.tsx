"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, api, json } from "@/lib/api";
import EntryCard, { type EntryRowData } from "../../entry-card";
import AccountPanel from "../../account-panel";
import Avatar from "../../avatar";

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
  const [search, setSearch] = useState("");
  const [searchError, setSearchError] = useState(false);
  const [submittedQ, setSubmittedQ] = useState("");
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [accessDenial, setAccessDenial] = useState<{
    viewerId: string;
    profileId: string;
    status: number;
  } | null>(null);

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
    queryKey: ["entries", viewerId, profile.id, submittedQ, recommendedOnly],
    enabled: canSee,
    retry: false,
    initialPageParam: 0,
    // The API orders, gates on friendship, and signs the photo URLs.
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        user_id: profile.id,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      if (submittedQ) params.set("q", submittedQ);
      if (recommendedOnly) params.set("recommended", "true");
      return api<EntryRowData[]>(`/entries?${params}`, { signal }).catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          // Other filter results must not reappear after this view remounts.
          queryClient.removeQueries({
            queryKey: ["entries", viewerId, profile.id],
            type: "inactive",
          });
          setAccessDenial({ viewerId, profileId: profile.id, status: error.status });
        }
        throw error;
      });
    },
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
  const deniedStatus = entries.error instanceof ApiError &&
    (entries.error.status === 401 || entries.error.status === 403)
    ? entries.error.status
    : null;
  const accessStatus = deniedStatus ??
    (accessDenial?.viewerId === viewerId && accessDenial.profileId === profile.id
      ? accessDenial.status
      : null);
  const accessDenied = accessStatus !== null;
  const filtered = !!submittedQ || recommendedOnly;

  return (
    <div className="profile-layout contents">
      <div className="profile-overview px-4 py-5">
        <div className="flex items-center gap-3">
          <Avatar src={profile.avatar_src} username={profile.username} size={14} />
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
        <div className="profile-history" aria-busy={entries.isFetching}>
          <form
            className="border-b border-[var(--color-divider)] px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              const q = search.trim();
              if ([...q].length > 120) {
                setSearchError(true);
                return;
              }
              setSearchError(false);
              setSubmittedQ(q);
            }}
          >
            <label className="kicker" htmlFor="profile-history-search">Search drink history</label>
            <div className="mt-2 flex gap-2">
              <input
                id="profile-history-search"
                className="input min-w-0 flex-1"
                type="search"
                value={search}
                aria-invalid={searchError}
                aria-describedby={searchError ? "profile-history-search-error" : undefined}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchError(false);
                }}
                placeholder="Drink, place, note, or night"
              />
              <button type="submit" className="btn btn-secondary !mt-0">Search</button>
            </div>
            {searchError && <p id="profile-history-search-error" role="alert" className="mt-2 text-sm">Search must be 120 characters or fewer.</p>}
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={recommendedOnly}
                  onChange={(event) => setRecommendedOnly(event.target.checked)}
                />
                Recommended only
              </label>
              {(filtered || search) && (
                <button
                  type="button"
                  className="btn btn-ghost !mt-0 text-sm"
                  onClick={() => {
                    setSearch("");
                    setSearchError(false);
                    setSubmittedQ("");
                    setRecommendedOnly(false);
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </form>
          {entries.isPending && !accessDenied && <p role="status" className="px-4 py-7 text-sm">Loading drink history…</p>}
          {((entries.isError && !entries.data) || accessDenied) && (
            <div role="alert" className="px-4 py-4 text-sm">
              {accessDenied ? (
                <>
                  <p>{accessStatus === 401
                    ? "Your session expired. Sign in to view drink history."
                    : "You no longer have access to this drink history."}</p>
                  {accessStatus === 403 && <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={entries.isFetching}
                    onClick={async () => {
                      const result = await entries.refetch();
                      if (result.isSuccess) setAccessDenial(null);
                    }}
                  >
                    Retry access
                  </button>}
                  <Link className="btn btn-secondary" href={accessStatus === 401 ? "/login" : "/friends"}>
                    {accessStatus === 401 ? "Sign in" : "View friends"}
                  </Link>
                </>
              ) : (
                <>
                  <p>Could not load drink history.</p>
                  <button type="button" className="btn btn-secondary" disabled={entries.isFetching} onClick={() => entries.refetch()}>
                    {entries.isFetching ? "Retrying…" : "Retry"}
                  </button>
                </>
              )}
            </div>
          )}
          {entries.isError && entries.data && !accessDenied && (
            <div role="alert" className="px-4 py-4 text-sm">
              <p>{entries.isFetchNextPageError
                ? "Could not load more drinks. Your earlier results are still here."
                : "Could not refresh drink history. Showing saved results."}</p>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={entries.isFetching}
                onClick={() => entries.isFetchNextPageError
                  ? entries.fetchNextPage()
                  : entries.refetch()}
              >
                {entries.isFetching ? "Retrying…" : "Retry"}
              </button>
            </div>
          )}
          {entries.isSuccess && !accessDenied && !entries.data.pages.some(page => page.length > 0) && (
            <p className="px-4 py-7 text-sm">{filtered ? "No drinks match these filters." : "No drinks logged yet."}</p>
          )}
          {!accessDenied && entries.data?.pages.flat().map((r) => (
            <EntryCard
              key={r.id}
              row={r}
              editHref={own ? `/log?id=${r.id}` : undefined}
              nightHref={
                own && r.night_out_id ? `/nights/${r.night_out_id}` : undefined
              }
            />
          ))}
          {!accessDenied && entries.hasNextPage && !entries.isFetchNextPageError && (
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
    </div>
  );
}
