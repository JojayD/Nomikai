"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, json } from "@/lib/api";

type Bar = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  prefetch?: boolean;
};
type Menu =
  | { status: "pending" | "none" }
  | { status: "ready"; items: { name: string }[]; sourceUrls: string[] };

// Menus this device has already loaded, reused for a day without a request.
// ponytail: one localStorage key per bar, never pruned; add cleanup if a
// device ever collects enough bars to matter.
const DAY = 24 * 60 * 60_000;
function savedMenu(barId: string): { at: number; menu: Menu } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`bar-menu:${barId}`) ?? "null");
    return saved && Date.now() - saved.at < DAY ? saved : null;
  } catch {
    return null;
  }
}

// The first read starts a web lookup, so poll while it runs and give up
// after about a minute.
async function fetchMenu(barId: string, signal: AbortSignal): Promise<Menu> {
  for (let tries = 0; ; tries++) {
    const found = await api<Menu>(`/bars/${barId}/menu`, { signal });
    if (found.status === "ready") {
      try {
        localStorage.setItem(
          `bar-menu:${barId}`,
          JSON.stringify({ at: Date.now(), menu: found }),
        );
      } catch {
        // storage full or blocked: the menu still shows, just not saved
      }
    }
    if (found.status !== "pending" || tries >= 20) return found;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
// "none" may just mean the daily cap, so only a found menu is kept long
const menuStaleTime = (query: { state: { data?: Menu } }) =>
  query.state.data?.status === "ready" ? DAY : 5 * 60_000;

export default function BarPicker({
  value,
  onChange,
  onPickDrink,
}: {
  value: string;
  onChange: (value: string) => void;
  onPickDrink: (name: string) => void;
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

  const queryClient = useQueryClient();
  // The position is sent for this one lookup and never stored.
  const nearby = useMutation({
    mutationFn: async () => {
      const { coords } = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 10_000,
          }),
      );
      return api<Bar[]>("/bars/nearby", {
        method: "POST",
        ...json({ lat: coords.latitude, lng: coords.longitude }),
      });
    },
    // Start the closest bars' menu lookups now, so the menu is usually ready
    // by the time one of them is picked.
    onSuccess: (found) => {
      for (const bar of found) {
        if (!bar.prefetch || savedMenu(bar.id)) continue;
        void queryClient.prefetchQuery({
          queryKey: ["bar-menu", bar.id],
          queryFn: ({ signal }) => fetchMenu(bar.id, signal),
          staleTime: menuStaleTime,
        });
      }
    },
  });
  const results = nearby.data ?? (showResults ? bars.data : undefined);

  // Drinks found on the picked bar's own menu.
  const [picked, setPicked] = useState<Bar | null>(null);
  const menu = useQuery({
    queryKey: ["bar-menu", picked?.id],
    queryFn: ({ signal }) => fetchMenu(picked!.id, signal),
    enabled: !!picked,
    initialData: () => (picked ? savedMenu(picked.id)?.menu : undefined),
    initialDataUpdatedAt: () => (picked ? savedMenu(picked.id)?.at : undefined),
    staleTime: menuStaleTime,
  });

  return (
    <div
      className="field mt-3"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          nearby.reset();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          nearby.reset();
        }
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
          setPicked(null);
          setOpen(true);
          nearby.reset();
        }}
      />
      <button
        type="button"
        className="btn btn-ghost self-start text-sm"
        // not `disabled`: a focused button that disables itself blurs, which
        // closes the picker and drops the lookup
        aria-disabled={nearby.isPending}
        onClick={() => {
          if (!nearby.isPending) nearby.mutate();
        }}
      >
        Use my location
      </button>
      {!!results?.length && (
        <ul aria-label="Bar suggestions" className="border border-current/20">
          {results.map((bar) => {
            const label = bar.city ? `${bar.name} — ${bar.city}` : bar.name;
            return (
              <li key={bar.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm hover:bg-black/5 focus-visible:bg-black/5"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(label);
                    setPicked(bar);
                    setOpen(false);
                    nearby.reset();
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
        {nearby.isPending
          ? "Finding bars near you…"
          : nearby.isError
            ? "Couldn't get your location. You can still search or type a place."
            : nearby.data
              ? nearby.data.length
                ? null
                : "No bars within 500 m. You can still search or type a place."
              : showResults &&
                (bars.isError
            ? "Bar search is unavailable. You can still type any place."
            : bars.isFetching
              ? "Searching bars…"
              : bars.isSuccess && !bars.data.length
                ? "No matching bars. You can still use what you typed."
                : null)}
      </p>
      {picked && menu.data?.status === "ready" && (
        <div>
          <p className="text-xs opacity-60">
            On the menu at {picked.name} ·{" "}
            <a
              href={menu.data.sourceUrls[0]}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              from the web
            </a>
          </p>
          <ul
            aria-label={`Drinks at ${picked.name}`}
            className="mt-1 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto"
          >
            {menu.data.items.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  className="border border-current/20 px-2.5 py-1 text-sm hover:bg-black/5 focus-visible:bg-black/5"
                  onClick={() => onPickDrink(item.name)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {picked && menu.isFetching && (
        <p role="status" className="text-xs opacity-60">
          Looking up the menu at {picked.name}…
        </p>
      )}
      <p id="location-help" className="text-xs opacity-60">
        Bay Area and Long Beach bars, or any place you type.{" "}
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
