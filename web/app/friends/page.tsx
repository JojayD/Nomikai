"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, json } from "@/lib/api";
import Header from "../header";
import Avatar from "../avatar";

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  requester: { username: string; avatar_src: string | null };
  addressee: { username: string; avatar_src: string | null };
};

function message(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === "23505") return "Already friends, or a request is pending.";
  if (err.code === "23514") return "That’s you.";
  return err.message ?? "Something went wrong.";
}

export default function FriendsPage() {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string; username: string; user_code: string }>("/me"),
    staleTime: Infinity,
  });
  const userId = me.data?.id ?? null;

  const friendships = useQuery({
    queryKey: ["friendships"],
    enabled: !!userId,
    queryFn: () => api<FriendshipRow[]>("/friendships"),
  });

  const send = useMutation({
    // The API resolves the username and rejects unknown ones with a 404.
    mutationFn: (username: string) =>
      api("/friendships", { method: "POST", ...json({ username }) }),
    onSuccess: () => {
      setAddName("");
      queryClient.invalidateQueries();
    },
  });

  const accept = useMutation({
    mutationFn: (id: string) => api(`/friendships/${id}`, { method: "PATCH" }),
    // acceptance changes what the feed and profiles show — refetch everything
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/friendships/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmRemove(null);
      queryClient.invalidateQueries();
    },
  });

  const rows = friendships.data ?? [];
  const incoming = rows.filter(
    (r) => r.status === "pending" && r.addressee_id === userId
  );
  const outgoing = rows.filter(
    (r) => r.status === "pending" && r.requester_id === userId
  );
  const friends = rows.filter((r) => r.status === "accepted");
  const other = (r: FriendshipRow) =>
    r.requester_id === userId ? r.addressee : r.requester;

  const failure = send.error ?? accept.error ?? remove.error;

  return (
    <main className="flex flex-1 flex-col">
      <Header kicker="Friends" />
      <div className="px-4 py-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (addName.trim()) send.mutate(addName);
          }}
        >
          <div className="field">
            <label htmlFor="addName">Add a friend by username</label>
            <div className="flex gap-2">
              <input
                id="addName"
                className="input flex-1"
                value={addName}
                onChange={(e) => setAddName(e.target.value.toLowerCase())}
                placeholder="username"
                autoComplete="off"
              />
              <button
                className="btn btn-primary !min-h-[42px]"
                disabled={send.isPending || !addName.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </form>
        {me.data && (
          <button
            type="button"
            className="btn btn-secondary btn-block !min-h-[42px]"
            onClick={async () => {
              await navigator.clipboard.writeText(
                `${window.location.origin}/add/${me.data.user_code}`
              );
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Link copied" : "Copy your invite link"}
          </button>
        )}
        {failure && (
          <p
            className="mt-3 text-sm font-semibold"
            style={{ color: "var(--color-accent)" }}
          >
            {message(failure)}
          </p>
        )}

        {incoming.length > 0 && (
          <>
            <div className="kicker mt-6 mb-2">Requests for you</div>
            {incoming.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <Avatar src={r.requester.avatar_src} username={r.requester.username} size={7} />
                <Link
                  href={`/u/${r.requester.username}`}
                  className="mr-auto font-extrabold !text-[inherit] no-underline"
                >
                  @{r.requester.username}
                </Link>
                <button
                  className="btn btn-primary !mt-0 !min-h-[36px] text-sm"
                  disabled={accept.isPending}
                  onClick={() => accept.mutate(r.id)}
                >
                  Accept
                </button>
                <button
                  className="btn btn-secondary !mt-0 !min-h-[36px] text-sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  Decline
                </button>
              </div>
            ))}
          </>
        )}

        {outgoing.length > 0 && (
          <>
            <div className="kicker mt-6 mb-2">Sent</div>
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-1.5">
                <Avatar src={r.addressee.avatar_src} username={r.addressee.username} size={7} />
                <Link
                  href={`/u/${r.addressee.username}`}
                  className="mr-auto font-extrabold !text-[inherit] no-underline"
                >
                  @{r.addressee.username}
                </Link>
                <button
                  className="btn btn-secondary !mt-0 !min-h-[36px] text-sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  Cancel
                </button>
              </div>
            ))}
          </>
        )}

        <div className="kicker mt-6 mb-2">Friends</div>
        {friendships.isPending && <div className="kicker">Loading…</div>}
        {friendships.isSuccess && friends.length === 0 && (
          <p className="text-[13.5px] opacity-70">
            No friends yet. Send a request or share your invite link.
          </p>
        )}
        {friends.map((r) => (
          <div key={r.id} className="flex items-center gap-2 py-1.5">
            <Avatar src={other(r).avatar_src} username={other(r).username} size={7} />
            <Link
              href={`/u/${other(r).username}`}
              className="mr-auto font-extrabold !text-[inherit] no-underline"
            >
              @{other(r).username}
            </Link>
            <button
              className="btn btn-secondary !mt-0 !min-h-[36px] text-sm"
              disabled={remove.isPending}
              onClick={() =>
                confirmRemove === r.id
                  ? remove.mutate(r.id)
                  : setConfirmRemove(r.id)
              }
            >
              {confirmRemove === r.id ? "Tap again to remove" : "Remove"}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
