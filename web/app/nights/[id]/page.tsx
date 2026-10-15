"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Header from "../../header";
import EntryCard, { type EntryRowData } from "../../entry-card";

type NightOut = {
  id: string;
  user_id: string;
  name: string;
  location: string | null;
  started_at: string;
};

export default function NightOutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string }>("/me"),
    staleTime: Infinity,
  });
  const viewerId = me.data?.id ?? null;

  const night = useQuery({
    queryKey: ["night", id],
    queryFn: () => api<NightOut>(`/night-outs/${id}`),
    retry: false,
  });

  const entries = useQuery({
    queryKey: ["night-entries", id],
    // The API gates on the night's owner and signs the photo URLs. The label
    // is already the page heading, so it is dropped from the rows.
    queryFn: async () =>
      (await api<EntryRowData[]>(`/night-outs/${id}/entries`)).map((r) => ({
        ...r,
        night_out_name: null,
      })),
  });

  return (
    <main className="desktop-page night-page flex flex-1 flex-col">
      <Header kicker="Night out" />
      {night.isPending ? (
        <div className="kicker px-4 py-7">Loading…</div>
      ) : night.isError ? (
        <p
          className="px-4 py-7 text-sm font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          Could not load that night out.
        </p>
      ) : (
        <>
          <div className="px-4 py-5">
            <h2 className="text-[26px] tracking-[-0.03em]">
              {night.data.name}
            </h2>
            <div className="mt-1 text-[13px] opacity-70">
              {new Date(night.data.started_at).toLocaleDateString()}
              {night.data.location && ` · ${night.data.location}`}
            </div>
          </div>
          {entries.data?.map((r) => (
            <EntryCard
              key={r.id}
              row={r}
              editHref={
                r.user_id === viewerId ? `/log?id=${r.id}` : undefined
              }
            />
          ))}
          {entries.isSuccess && !entries.data.length && (
            <p className="px-4 text-[13.5px] opacity-70">
              No entries in this night out.
            </p>
          )}
        </>
      )}
    </main>
  );
}
