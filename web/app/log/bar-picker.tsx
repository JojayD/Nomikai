"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Bar = { name: string; city: string | null; address: string | null };

export default function BarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = value.trim().toLowerCase();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const bars = useQuery({
    queryKey: ["bars", query],
    queryFn: ({ signal }) =>
      api<Bar[]>(`/bars?q=${encodeURIComponent(query)}`, { signal }),
    enabled: open && !!query && query === search,
    staleTime: Infinity,
  });
  const showResults = open && !!query && query === search;

  return (
    <div
      className="field mt-3"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <label htmlFor="location">Where · optional</label>
      <input
        id="location"
        className="input"
        value={value}
        autoComplete="off"
        aria-describedby="location-help"
        placeholder="Search bars or type a place"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      {showResults && !!bars.data?.length && (
        <ul aria-label="Bar suggestions" className="border border-current/20">
          {bars.data.map((bar) => {
            const label = bar.city ? `${bar.name} — ${bar.city}` : bar.name;
            return (
              <li key={JSON.stringify([bar.name, bar.city, bar.address])}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 focus-visible:bg-black/5"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(label);
                    setOpen(false);
                  }}
                >
                  <span className="block font-semibold">{label}</span>
                  {bar.address && (
                    <span className="text-xs opacity-60">{bar.address}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" className="text-xs opacity-60">
        {showResults &&
          (bars.isError
            ? "Bar search is unavailable. You can still type any place."
            : bars.isFetching
              ? "Searching bars…"
              : bars.isSuccess && !bars.data.length
                ? "No matching bars. You can still use what you typed."
                : null)}
      </p>
      <p id="location-help" className="text-xs opacity-60">
        Bay Area bars, or any place you type.{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          © OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
}
