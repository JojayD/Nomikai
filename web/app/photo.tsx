"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

// Key by URL at the call site so a newly signed URL resets a failed image.
export default function Photo({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const client = useQueryClient();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useMutation({
    // Refetch the owning feed/history to obtain fresh signed URLs.
    mutationFn: () =>
      client.refetchQueries({ type: "active" }, { throwOnError: true }),
    onSuccess: () => {
      setFailed(false);
      setLoaded(false);
      setAttempt((value) => value + 1);
    },
  });

  if (!src || failed)
    return (
      <div
        className="mt-2 border border-[var(--color-divider)] p-3 text-sm"
        role="status"
      >
        <p>Photo unavailable</p>
        <button
          type="button"
          className="btn btn-ghost text-sm"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {retry.isPending ? "Retrying…" : "Retry photo"}
        </button>
        {retry.isError && (
          <p>Could not reload the photo. Try again when connected.</p>
        )}
      </div>
    );

  return (
    <>
      {!loaded && (
        <p role="status" className="mt-2 text-sm opacity-70">
          Loading photo…
        </p>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL */}
      <img
        key={attempt}
        src={src}
        alt={alt}
        className={className}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </>
  );
}
