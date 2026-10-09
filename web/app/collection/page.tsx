"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, json } from "@/lib/api";
import { normalizeDrinkName } from "@/lib/normalize";
import Header from "../header";
import SaveDrink from "../save-drink";

type SavedDrink = { id: string; name: string; tried: boolean };
type FriendPick = {
  normalized_name: string;
  name: string;
  recommenders: string[];
  last_recommended_at: string;
};
type Stamp = {
  normalized_name: string;
  name: string;
  first_logged_at: string;
  last_logged_at: string;
  times_logged: number;
  recommended: boolean | null;
};

export default function Collection() {
  const client = useQueryClient();
  const [view, setView] = useState<"saved" | "passport" | "picks">("saved");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [recommended, setRecommended] = useState(false);
  const saved = useQuery({
    queryKey: ["saved-drinks"],
    queryFn: () => api<SavedDrink[]>("/collection/saved"),
    enabled: view === "saved",
  });
  const passport = useQuery({
    queryKey: ["passport"],
    queryFn: () => api<Stamp[]>("/collection/passport"),
    enabled: view === "passport",
  });
  const picks = useQuery({
    queryKey: ["friend-picks"],
    queryFn: () => api<FriendPick[]>("/collection/picks"),
    enabled: view === "picks",
  });
  const add = useMutation({
    mutationFn: (value: string) =>
      api("/collection/saved", { method: "PUT", ...json({ name: value }) }),
    onSuccess: () => {
      setName("");
      return client.invalidateQueries({ queryKey: ["saved-drinks"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/collection/saved/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["saved-drinks"] }),
  });
  const current = view === "saved" ? saved : view === "passport" ? passport : picks;
  const matches = (passport.data ?? []).filter(
    (drink) =>
      (!recommended || drink.recommended === true) &&
      normalizeDrinkName(drink.name).includes(normalizeDrinkName(search)),
  );

  return (
    <main className="flex flex-1 flex-col">
      <Header kicker="Your collection" />
      <div className="p-4">
        <h2 className="text-3xl">A little taste of you.</h2>
        <p className="mt-2 text-sm opacity-70">
          Drinks to discover. Favorites to remember. Your saved drinks and passport stay private.
        </p>
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Collection views">
          <button
            className={`btn ${view === "saved" ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={view === "saved"}
            onClick={() => setView("saved")}
          >
            Want to try
          </button>
          <button
            className={`btn ${view === "passport" ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={view === "passport"}
            onClick={() => setView("passport")}
          >
            Passport
          </button>
          <button
            className={`btn ${view === "picks" ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={view === "picks"}
            onClick={() => setView("picks")}
          >
            From friends
          </button>
        </div>
        {view === "saved" ? (
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !add.isPending) add.mutate(name);
            }}
          >
            <label className="kicker" htmlFor="drink-name">
              Drink name
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                id="drink-name"
                className="input min-w-0 flex-1"
                value={name}
                disabled={add.isPending}
                required
                placeholder="Something you’d like to try"
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={add.isPending || !name.trim()}
              >
                {add.isPending ? "Saving…" : "Save drink"}
              </button>
            </div>
            {add.error && (
              <p className="mt-2 text-sm" role="alert">
                {add.error.message}
              </p>
            )}
          </form>
        ) : view === "passport" ? (
          <div className="mt-5">
            {passport.data && (
              <p className="kicker mb-3">
                {passport.data.length} unique drinks
              </p>
            )}
            <label className="kicker" htmlFor="passport-search">
              Search your passport
            </label>
            <input
              id="passport-search"
              className="input mt-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a drink"
            />
            <div className="mt-3 flex gap-2">
              <button
                className={`btn ${!recommended ? "btn-secondary" : "btn-ghost"}`}
                aria-pressed={!recommended}
                onClick={() => setRecommended(false)}
              >
                All
              </button>
              <button
                className={`btn ${recommended ? "btn-secondary" : "btn-ghost"}`}
                aria-pressed={recommended}
                onClick={() => setRecommended(true)}
              >
                Recommended
              </button>
            </div>
          </div>
        ) : null}
        {current.isPending && (
          <p className="kicker py-7" role="status">
            Loading…
          </p>
        )}
        {current.isError ? (
          <div className="py-5">
            <p role="alert">Could not load your collection.</p>
            <button
              className="btn btn-secondary mt-2"
              onClick={() => current.refetch()}
            >
              Retry
            </button>
          </div>
        ) : view === "saved" ? (
          <>
            {saved.data?.length === 0 && (
              <p className="py-7 text-sm">Your next discovery starts here.</p>
            )}
            {remove.error && (
              <p role="alert" className="mt-3 text-sm">
                {remove.error.message} Try removing it again.
              </p>
            )}
            <ul className="mt-4">
              {saved.data?.map((drink) => (
                <li
                  key={drink.id}
                  className="border-t border-[var(--color-divider)] py-4"
                >
                  <h3 className="break-words text-xl">{drink.name}</h3>
                  <p className="kicker mt-1">
                    {drink.tried
                      ? "Tried · in your passport"
                      : "Waiting to be discovered"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      className="btn btn-secondary text-sm"
                      aria-label={`Log ${drink.name}`}
                      href={`/log?drink=${encodeURIComponent(drink.name)}`}
                    >
                      {drink.tried ? "Log again" : "Log this drink"}
                    </Link>
                    <button
                      className="btn btn-ghost text-sm"
                      aria-label={`Remove ${drink.name}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(drink.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : view === "picks" ? (
          <>
            {picks.data?.length === 0 && (
              <p className="py-7 text-sm">
                No friend picks yet.{" "}
                <Link href="/friends">Add friends</Link> to see what they recommend.
              </p>
            )}
            <ul className="mt-4">
              {picks.data?.map((drink) => (
                <li
                  key={drink.normalized_name}
                  className="border-t border-[var(--color-divider)] py-4"
                >
                  <h3 className="break-words text-xl">{drink.name}</h3>
                  <p className="kicker mt-1">
                    Recommended by {drink.recommenders.join(", ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SaveDrink name={drink.name} onOpen={() => setView("saved")} />
                    <Link
                      className="btn btn-secondary text-sm"
                      aria-label={`Log ${drink.name}`}
                      href={`/log?drink=${encodeURIComponent(drink.name)}`}
                    >
                      Log this drink
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {passport.data?.length === 0 ? (
              <p className="py-7 text-sm">
                Your passport starts with your first drink.{" "}
                <Link href="/log">Log a drink</Link>
              </p>
            ) : (
              passport.data &&
              matches.length === 0 && (
                <p className="py-7 text-sm">No drinks match these filters.</p>
              )
            )}
            <ul className="mt-4">
              {matches.map((drink) => (
                <li
                  key={drink.normalized_name}
                  className="border-t border-[var(--color-divider)] py-4"
                >
                  <h3 className="break-words text-xl">{drink.name}</h3>
                  <p className="kicker mt-1">
                    {drink.times_logged}{" "}
                    {drink.times_logged === 1 ? "log" : "logs"}
                    {drink.recommended === true
                      ? " · Recommended"
                      : drink.recommended === false
                        ? " · Skip it"
                        : ""}
                  </p>
                  <p className="mt-2 text-sm opacity-70">
                    First {new Date(drink.first_logged_at).toLocaleDateString()}{" "}
                    · Last {new Date(drink.last_logged_at).toLocaleDateString()}
                  </p>
                  <Link
                    className="btn btn-secondary mt-3 text-sm"
                    aria-label={`Log ${drink.name} again`}
                    href={`/log?drink=${encodeURIComponent(drink.name)}`}
                  >
                    Log again
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
