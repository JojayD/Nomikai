"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, api, json } from "@/lib/api";
import { normalizeDrinkName } from "@/lib/normalize";
import { compressPhoto, photoForm } from "@/lib/photo";
import Header from "../header";

type Drink = {
  id: number;
  name: string;
  normalized_name: string;
  is_alcoholic: boolean;
};

// drinkId null = free-text entry
type Selection = { drinkId: number | null; name: string };

type EntryRow = {
  drink_id: number | null;
  drink_name: string | null;
  custom_drink_name: string | null;
  night_out_id: string | null;
  night_out_name: string | null;
  logged_at: string;
  location: string | null;
  note: string | null;
  recommended: boolean | null;
  photo_path: string | null;
};

type HistoryRow = {
  drink_id: number | null;
  custom_drink_name: string | null;
  normalized_drink_name: string;
};

// One autocomplete option: from the user's history (timesLogged > 0) or the
// curated list. drinkId null = free-text entry.
type Option = {
  drinkId: number | null;
  name: string;
  normalized: string;
  isAlcoholic: boolean | null;
  timesLogged: number;
};

function toLocalInput(d: Date) {
  const c = new Date(d);
  c.setMinutes(c.getMinutes() - c.getTimezoneOffset());
  return c.toISOString().slice(0, 16);
}

export default function LogPage() {
  return (
    <Suspense>
      <LogLoader />
    </Suspense>
  );
}

// Edit mode needs the entry in hand before the form mounts: the inputs are
// controlled, so their initial values are the seeding step.
function LogLoader() {
  const editId = useSearchParams().get("id");
  const entry = useQuery({
    queryKey: ["entry", editId],
    queryFn: () => api<EntryRow>(`/entries/${editId}`),
    enabled: !!editId,
    retry: false,
  });

  if (editId && entry.isPending) {
    return (
      <main className="flex flex-1 flex-col">
        <Header kicker="Log a drink" />
        <div className="kicker px-4 py-7">Loading…</div>
      </main>
    );
  }
  if (editId && entry.isError) {
    return (
      <main className="flex flex-1 flex-col">
        <Header kicker="Log a drink" />
        <p
          className="px-4 py-7 text-sm font-semibold"
          style={{ color: "var(--color-accent)" }}
        >
          Could not load that entry.
        </p>
      </main>
    );
  }
  return <LogForm editId={editId} entry={entry.data ?? null} />;
}

function LogForm({
  editId,
  entry,
}: {
  editId: string | null;
  entry: EntryRow | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ id: string } | null>("/me"),
    staleTime: Infinity,
  });
  const userId = me.data?.id ?? null;
  useEffect(() => {
    if (me.isSuccess && !me.data) router.push("/login");
  }, [me.isSuccess, me.data, router]);

  // Curated list: fetched on first focus, then reused for the session.
  const [drinksWanted, setDrinksWanted] = useState(false);
  const drinks = useQuery({
    queryKey: ["drinks"],
    queryFn: () => api<Drink[]>("/drinks"),
    enabled: drinksWanted,
    staleTime: Infinity,
  });

  // Own logging history, for ranking repeats above the curated list (F4).
  const history = useQuery({
    queryKey: ["drink-history"],
    enabled: drinksWanted && !!userId,
    queryFn: () => api<HistoryRow[]>("/entries/history"),
  });

  const [sel, setSel] = useState<Selection | null>(
    entry
      ? {
          drinkId: entry.drink_id,
          name: entry.drink_id ? entry.drink_name! : entry.custom_drink_name!,
        }
      : null
  );
  const [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(!!entry);
  const [loggedAt, setLoggedAt] = useState(() =>
    toLocalInput(entry ? new Date(entry.logged_at) : new Date())
  );
  const [location, setLocation] = useState(entry?.location ?? "");
  const [note, setNote] = useState(entry?.note ?? "");
  const [rec, setRec] = useState<boolean | null>(entry?.recommended ?? null);
  const [photo, setPhoto] = useState<File | null>(null);
  // edit mode: path of the photo already on the entry; removePhoto marks it for deletion
  const existingPhotoPath = entry?.photo_path ?? null;
  const [removePhoto, setRemovePhoto] = useState(false);

  // Night out (F12): "" = none, "__new__" = create one at save time.
  const [nightSel, setNightSel] = useState(entry?.night_out_id ?? "");
  const [newNightName, setNewNightName] = useState("");
  const [newNightLoc, setNewNightLoc] = useState("");
  const nights = useQuery({
    queryKey: ["night-outs"],
    enabled: showDetails && !!userId,
    queryFn: () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      return api<{ id: string; name: string }[]>(
        `/night-outs?since=${encodeURIComponent(since.toISOString())}`
      );
    },
  });
  // Editing an entry whose night out is older than the 7-day window: keep it
  // selectable rather than silently dropping the assignment.
  const nightOptions =
    entry?.night_out_id && !nights.data?.some((n) => n.id === entry.night_out_id)
      ? [{ id: entry.night_out_id, name: entry.night_out_name ?? "…" }, ...(nights.data ?? [])]
      : (nights.data ?? []);

  // In-app camera (video only, no audio). Stream lives here; the effect below
  // owns stopping tracks on close/unmount. camClosed covers the gap where
  // getUserMedia is still pending — a stream resolving after close/unmount
  // must be stopped, not set.
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const camClosed = useRef(false);
  useEffect(() => {
    return () => camStream?.getTracks().forEach((t) => t.stop());
  }, [camStream]);
  useEffect(() => {
    return () => {
      camClosed.current = true;
    };
  }, []);

  async function openCamera() {
    setCamError(null);
    camClosed.current = false;
    try {
      // Triggers the browser's standard camera permission prompt.
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (camClosed.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      setCamStream(s);
    } catch {
      setCamError("Camera unavailable — allow camera access or pick a file instead.");
    }
  }

  function closeCamera() {
    camClosed.current = true;
    setCamStream(null);
  }

  function capturePhoto() {
    const v = camVideoRef.current;
    // readyState < HAVE_CURRENT_DATA would drawImage nothing → black JPEG
    if (!v || v.readyState < 2) {
      setCamError("Camera is still starting — try again.");
      return;
    }
    setCamError(null);
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(
      (b) => {
        if (!b) {
          setCamError("Could not capture photo — try again.");
          return;
        }
        const f = new File([b], "camera.jpg", { type: "image/jpeg" });
        setPhoto(f);
        setRemovePhoto(false);
        if (photoInputRef.current) {
          // show the capture in the file input natively
          const dt = new DataTransfer();
          dt.items.add(f);
          photoInputRef.current.files = dt.files;
        }
        closeCamera();
      },
      "image/jpeg",
      0.9
    );
  }

  const [camError, setCamError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);

  // Stable across retries so a re-tap after the entry landed but the photo
  // failed reuses the same rows instead of inserting duplicates. Reset per
  // fresh entry in resetForm.
  const entryId = useRef(crypto.randomUUID());
  const nightId = useRef(crypto.randomUUID());

  function entryFields() {
    return {
      drink_id: sel!.drinkId,
      custom_drink_name: sel!.drinkId ? null : sel!.name,
      night_out_id: nightSel && nightSel !== "__new__" ? nightSel : null,
      logged_at: new Date(loggedAt).toISOString(),
      location: location.trim() || null,
      note: note.trim() || null,
      recommended: rec,
    };
  }

  // Snapshotted at submit time and passed in, so a re-render mid-flight cannot
  // swap the values out from under an in-flight write.
  type Payload = {
    fields: ReturnType<typeof entryFields>;
    photoFile: File | null;
    newNight: { id: string; name: string; location: string | null } | null;
  };

  // "+ New night out" is created alongside the entry, in one transaction, so
  // a failed save cannot leave an orphan session behind.
  const saveEdit = useMutation({
    mutationFn: async ({ fields, photoFile, newNight }: Payload) => {
      await api(`/entries/${editId}`, {
        method: "PATCH",
        ...json({ ...fields, new_night_out: newNight }),
      });
      if (photoFile) {
        await api(`/entries/${editId}/photo`, {
          method: "POST",
          body: photoForm(await compressPhoto(photoFile)),
        });
      } else if (removePhoto && existingPhotoPath) {
        await api(`/entries/${editId}/photo`, { method: "DELETE" });
      }
    },
    onSuccess: () => {
      // feed, profile history, stats, and the night-out list all reflect a
      // saved entry — refetch everything rather than tracking keys
      queryClient.invalidateQueries();
      setSaved({ id: editId!, name: sel!.name });
    },
  });

  const createEntry = useMutation({
    // The id is generated here so the confirmation screen can link to the
    // entry before the write lands.
    mutationFn: async ({ id, fields, photoFile, newNight }: Payload & { id: string }) => {
      try {
        await api("/entries", {
          method: "POST",
          ...json({ id, ...fields, new_night_out: newNight }),
        });
      } catch (e) {
        // Retry after the entry landed but the photo step failed: the row (and
        // its night out) already exist, so skip to the photo rather than
        // inserting a duplicate. id is client-generated, so a 23505 here can
        // only be this same entry.
        if (!(e instanceof ApiError) || e.code !== "23505") throw e;
      }
      if (photoFile) {
        await api(`/entries/${id}/photo`, {
          method: "POST",
          body: photoForm(await compressPhoto(photoFile)),
        });
      }
    },
    onSuccess: () => queryClient.invalidateQueries(),
    // restore the form with everything intact so retry is one tap
    onError: () => setSaved(null),
  });

  const removeEntry = useMutation({
    // The API removes the stored photo along with the row.
    mutationFn: () => api(`/entries/${editId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["entry", editId] });
      queryClient.invalidateQueries();
      router.push("/");
      router.refresh();
    },
  });

  const busy = saveEdit.isPending || removeEntry.isPending;
  const pending = createEntry.isPending;
  const failure = saveEdit.error ?? createEntry.error ?? removeEntry.error;
  const error =
    camError ??
    (failure
      ? failure instanceof Error
        ? failure.message
        : "Could not save."
      : null);

  const normalizedQuery = normalizeDrinkName(query);
  // F4 ranking: own repeats (by times logged) above the curated list.
  let matches: Option[] = [];
  if (normalizedQuery) {
    const byId = new Map((drinks.data ?? []).map((d) => [d.id, d]));
    const hist = new Map<string, Option>();
    for (const h of history.data ?? []) {
      const existing = hist.get(h.normalized_drink_name);
      if (existing) {
        existing.timesLogged++;
        continue;
      }
      const curated = h.drink_id ? byId.get(h.drink_id) : undefined;
      const name = curated?.name ?? h.custom_drink_name;
      if (!name) continue; // curated list still loading
      hist.set(h.normalized_drink_name, {
        drinkId: h.drink_id,
        name,
        normalized: h.normalized_drink_name,
        isAlcoholic: curated?.is_alcoholic ?? null,
        timesLogged: 1,
      });
    }
    const histMatches = [...hist.values()]
      .filter((o) => o.normalized.includes(normalizedQuery))
      .sort((a, b) => b.timesLogged - a.timesLogged);
    const curatedMatches = (drinks.data ?? [])
      .filter(
        (d) =>
          d.normalized_name.includes(normalizedQuery) &&
          !hist.has(d.normalized_name)
      )
      .map(
        (d): Option => ({
          drinkId: d.id,
          name: d.name,
          normalized: d.normalized_name,
          isAlcoholic: d.is_alcoholic,
          timesLogged: 0,
        })
      );
    matches = [...histMatches, ...curatedMatches].slice(0, 8);
  }
  const exactMatch = matches.some((m) => m.normalized === normalizedQuery);

  function resetForm() {
    setSel(null);
    setQuery("");
    setShowDetails(false);
    setLoggedAt(toLocalInput(new Date()));
    setLocation("");
    setNote("");
    setRec(null);
    setNightSel("");
    setNewNightName("");
    setNewNightLoc("");
    setPhoto(null);
    closeCamera();
    setCamError(null);
    setSaved(null);
    entryId.current = crypto.randomUUID();
    nightId.current = crypto.randomUUID();
    saveEdit.reset();
    createEntry.reset();
  }

  function submit() {
    if (!sel || !userId) return;
    setCamError(null);
    closeCamera();

    const payload = {
      fields: entryFields(),
      photoFile: photo,
      newNight:
        nightSel === "__new__" && newNightName.trim()
          ? {
              id: nightId.current,
              name: newNightName.trim(),
              location: newNightLoc.trim() || null,
            }
          : null,
    };
    if (editId) return saveEdit.mutate(payload);

    // New entry: optimistic — confirmation renders now, insert runs behind it.
    const id = entryId.current;
    setSaved({ id, name: sel.name });
    createEntry.mutate({ id, ...payload });
  }

  if (saved) {
    return (
      <main className="flex flex-1 flex-col">
        <Header kicker="Log a drink" />
        <div className="px-4 py-7">
          <div className="kicker mb-2">Logged</div>
          <h2 className="text-[32px] leading-[1.05] tracking-[-0.03em]">
            {saved.name}
          </h2>
          <button
            className="btn btn-primary btn-block mt-6"
            disabled={pending}
            onClick={resetForm}
          >
            Log another
          </button>
          {!editId && (
            <button
              className="btn btn-secondary btn-block"
              disabled={pending}
              onClick={() => {
                router.replace(`/log?id=${saved.id}`);
                setSaved(null);
              }}
            >
              Edit details
            </button>
          )}
          <Link
            href="/"
            aria-disabled={pending}
            onClick={(e) => pending && e.preventDefault()}
            className={`btn btn-secondary btn-block ${pending ? "pointer-events-none opacity-50" : ""}`}
          >
            Done
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <Header kicker="Log a drink" />
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {sel ? (
          <div
            className="flex items-baseline gap-3 border px-3.5 py-3"
            style={{ borderColor: "var(--color-divider)" }}
          >
            <span className="mr-auto text-[20px] font-extrabold tracking-[-0.02em]">
              {sel.name}
            </span>
            <button
              type="button"
              className="btn btn-ghost text-sm"
              onClick={() => {
                setSel(null);
                setQuery("");
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="drink">What are you drinking?</label>
            <input
              id="drink"
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setDrinksWanted(true)}
              placeholder="Start typing…"
              autoComplete="off"
              autoFocus
            />
            {normalizedQuery && (
              <div
                className="border border-t-0"
                style={{ borderColor: "var(--color-divider)" }}
              >
                {matches.map((m) => (
                  <button
                    key={m.normalized}
                    type="button"
                    className="block w-full cursor-pointer px-3.5 py-2.5 text-left text-[15px] hover:bg-[var(--color-surface)]"
                    onClick={() => setSel({ drinkId: m.drinkId, name: m.name })}
                  >
                    {m.name}
                    {m.timesLogged > 0 && (
                      <span className="kicker ml-2">
                        logged {m.timesLogged}×
                      </span>
                    )}
                    {m.isAlcoholic === false && (
                      <span className="kicker ml-2">zero proof</span>
                    )}
                  </button>
                ))}
                {!exactMatch && (
                  <button
                    type="button"
                    className="block w-full cursor-pointer px-3.5 py-2.5 text-left text-[15px] hover:bg-[var(--color-surface)]"
                    onClick={() => setSel({ drinkId: null, name: query.trim() })}
                  >
                    Log “{query.trim()}” as written
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {showDetails ? (
          <>
            <div className="field mt-4">
              <label htmlFor="loggedAt">When</label>
              <input
                id="loggedAt"
                className="input"
                type="datetime-local"
                value={loggedAt}
                onChange={(e) => setLoggedAt(e.target.value)}
                required
              />
            </div>
            <div className="field mt-3">
              <label htmlFor="location">Where · optional</label>
              <input
                id="location"
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="field mt-3">
              <label htmlFor="note">
                Note · optional · {note.length}/140
              </label>
              <input
                id="note"
                className="input"
                maxLength={140}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="field mt-3">
              <label>Recommend it?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`btn !mt-0 flex-1 !min-h-[42px] ${rec === true ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setRec(rec === true ? null : true)}
                >
                  Yes
                </button>
                <button
                  type="button"
                  className={`btn !mt-0 flex-1 !min-h-[42px] ${rec === false ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setRec(rec === false ? null : false)}
                >
                  No
                </button>
              </div>
            </div>
            <div className="field mt-3">
              <label htmlFor="nightOut">Night out · optional</label>
              <select
                id="nightOut"
                className="input"
                value={nightSel}
                onChange={(e) => setNightSel(e.target.value)}
              >
                <option value="">None</option>
                {nightOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
                <option value="__new__">+ New night out</option>
              </select>
              {nightSel === "__new__" && (
                <div className="mt-2 flex flex-col gap-2">
                  <input
                    className="input"
                    value={newNightName}
                    onChange={(e) => setNewNightName(e.target.value)}
                    placeholder="Name, e.g. Marcus birthday"
                    maxLength={80}
                    required
                  />
                  <input
                    className="input"
                    value={newNightLoc}
                    onChange={(e) => setNewNightLoc(e.target.value)}
                    placeholder="Where · optional"
                  />
                </div>
              )}
            </div>
            <div className="field mt-3">
              <label htmlFor="photo">
                Photo · optional
                {existingPhotoPath && !removePhoto && !photo && " · attached"}
              </label>
              <input
                id="photo"
                ref={photoInputRef}
                className="input !py-2"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setPhoto(e.target.files?.[0] ?? null);
                  setRemovePhoto(false);
                }}
              />
              {camStream ? (
                <>
                  <video
                    className="mt-2 w-full"
                    ref={(el) => {
                      camVideoRef.current = el;
                      if (el && el.srcObject !== camStream)
                        el.srcObject = camStream;
                    }}
                    autoPlay
                    playsInline
                    muted
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-primary !mt-2 flex-1 !min-h-[42px]"
                      onClick={capturePhoto}
                    >
                      Capture
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary !mt-2 flex-1 !min-h-[42px]"
                      onClick={closeCamera}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary !mt-2 btn-block !min-h-[42px]"
                  onClick={openCamera}
                >
                  Take photo
                </button>
              )}
              {existingPhotoPath && !removePhoto && !photo && (
                <button
                  type="button"
                  className="btn btn-ghost mt-1 text-sm"
                  onClick={() => setRemovePhoto(true)}
                >
                  Remove current photo
                </button>
              )}
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost mt-4 text-sm"
            onClick={() => setShowDetails(true)}
          >
            + Add details — time, place, note, photo
          </button>
        )}

        <button
          className="btn btn-primary btn-block mt-6"
          disabled={!sel || busy || !userId}
        >
          {editId ? "Save changes" : "Log it"}
        </button>
        {editId && (
          <button
            type="button"
            className="btn btn-block !min-h-[42px]"
            style={{
              borderColor: "var(--color-accent)",
              color: "var(--color-accent)",
              borderWidth: 1,
            }}
            disabled={busy}
            onClick={() => removeEntry.mutate()}
          >
            Delete entry
          </button>
        )}
        {error && (
          <p
            className="mt-4 text-sm font-semibold"
            style={{ color: "var(--color-accent)" }}
          >
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
