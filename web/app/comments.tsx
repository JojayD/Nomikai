"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, json } from "@/lib/api";

type Comment = {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
};

/** The thread under an entry: loaded when opened, refetched after each write. */
export default function Comments({
  entryId,
  ownerId,
  count,
}: {
  entryId: string;
  ownerId: string;
  count: number;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string } | null>("/me"),
    staleTime: Infinity,
    enabled: open,
  });
  const comments = useQuery({
    queryKey: ["comments", entryId],
    queryFn: () => api<Comment[]>(`/entries/${entryId}/comments`),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: () =>
      api(`/entries/${entryId}/comments`, { method: "POST", ...json({ body: text }) }),
    onSuccess: () => setText(""),
    onSettled: () => client.invalidateQueries(),
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/entries/${entryId}/comments/${id}`, { method: "DELETE" }),
    onSettled: () => client.invalidateQueries(),
  });
  const shown = comments.data?.length ?? count;

  return (
    <>
      <button
        className="cursor-pointer text-[13px] font-semibold tabular-nums"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {shown > 0 ? `${shown} comment${shown === 1 ? "" : "s"}` : "Comment"}
      </button>
      {open && (
        <div className="w-full">
          {comments.isError && (
            <p role="alert" className="text-xs">Could not load comments.</p>
          )}
          <ul>
            {comments.data?.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 py-1 text-[14px]">
                <span className="min-w-0 break-words">
                  <Link
                    href={`/u/${c.username}`}
                    className="font-extrabold !text-[inherit] no-underline"
                  >
                    @{c.username}
                  </Link>{" "}
                  {c.body}
                </span>
                {(c.user_id === me.data?.id || ownerId === me.data?.id) && (
                  <button
                    className="btn btn-ghost ml-auto text-xs"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.id)}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim() && !add.isPending) add.mutate();
            }}
          >
            <input
              className="input min-w-0 flex-1"
              aria-label="Add a comment"
              placeholder="Add a comment"
              maxLength={280}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              className="btn btn-secondary"
              disabled={!text.trim() || add.isPending}
            >
              Post
            </button>
          </form>
          {(add.isError || remove.isError) && (
            <p role="alert" className="text-xs">Could not save. Try again.</p>
          )}
        </div>
      )}
    </>
  );
}
