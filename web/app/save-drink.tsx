"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, json } from "@/lib/api";

export default function SaveDrink({
  name,
  onOpen,
}: {
  name: string;
  onOpen?: () => void; // already on /collection: switch views instead
}) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api("/collection/saved", { method: "PUT", ...json({ name }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["saved-drinks"] }),
  });
  return (
    <div className="text-xs">
      {save.isSuccess ? (
        <Link href="/collection" role="status" onClick={onOpen}>
          Saved to Want to try
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={save.isPending}
          aria-label={`Want to try ${name}`}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "+ Want to try"}
        </button>
      )}
      {save.error && <p role="alert">{save.error.message} Try again.</p>}
    </div>
  );
}
