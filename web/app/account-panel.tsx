"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, json } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { compressPhoto, photoForm } from "@/lib/photo";

// ApiError carries the SQLSTATE; Supabase auth errors don't.
function message(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === "23505") return "That username is taken.";
  return err.message ?? "Something went wrong.";
}

export default function AccountPanel(props: {
  username: string;
  userCode: string;
  timezone: string;
  email: string;
  avatarUrl: string | null;
  leaderboardOptIn: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(props.username);
  const [timezone, setTimezone] = useState(props.timezone);
  const [optIn, setOptIn] = useState(props.leaderboardOptIn);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timezones = useMemo<string[]>(
    () =>
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [props.timezone],
    [props.timezone]
  );

  const save = useMutation({
    mutationFn: () =>
      api("/me", {
        method: "PATCH",
        ...json({ username, timezone, leaderboard_opt_in: optIn }),
      }),
    // The profile is rendered by the server component above us.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      router.refresh();
    },
  });

  const uploadAvatar = useMutation({
    // The API derives the storage path and stores it on the profile.
    mutationFn: async (file: File) =>
      api("/me/avatar", {
        method: "POST",
        body: photoForm(await compressPhoto(file)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      router.refresh();
    },
  });

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().auth.signOut();
      if (error) throw error;
    },
    onSuccess: () => {
      // No query key is user-scoped, so drop the whole cache: otherwise the
      // next account signed in on this device reads the previous user's data.
      queryClient.clear();
      router.push("/login");
      router.refresh();
    },
  });

  const deleteAccount = useMutation({
    // §3: the API purges the photos folder, then deletes the auth user, which
    // cascades every row.
    mutationFn: async () => {
      await api("/me", { method: "DELETE" });
      // scope local: the account is gone, so a server-side logout would 403.
      await createClient().auth.signOut({ scope: "local" });
    },
    onSuccess: () => {
      queryClient.clear();
      router.push("/login");
      router.refresh();
    },
  });

  const busy = save.isPending || deleteAccount.isPending;
  const failure =
    save.error ?? signOut.error ?? deleteAccount.error ?? uploadAvatar.error;
  const status = failure
    ? message(failure)
    : save.isSuccess || uploadAvatar.isSuccess
      ? "Saved."
      : null;

  return (
    <div className="mt-auto px-4 pb-8">
      <div className="hr mb-4" />
      <div className="kicker mb-3">Account</div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="field mb-3">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            pattern="[a-z0-9_]{3,20}"
            title="3–20 characters: lowercase letters, numbers, underscores"
            required
          />
        </div>
        <div className="field mb-3">
          <label htmlFor="timezone">Timezone</label>
          <select
            id="timezone"
            className="input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <label className="mb-3 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-0.5 size-5 accent-[var(--color-accent)]"
          />
          <span className="text-[13px] leading-[1.45]">
            Appear on leaderboards. Off removes you from every friend&apos;s
            board — yours shows only you.
          </span>
        </label>
        <button className="btn btn-secondary btn-block !min-h-[42px]" disabled={busy}>
          Save changes
        </button>
      </form>

      <div className="field mt-3">
        <label htmlFor="avatar">
          {props.avatarUrl ? "Change avatar" : "Avatar"}
        </label>
        <input
          id="avatar"
          className="input !py-2"
          type="file"
          accept="image/*"
          disabled={uploadAvatar.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAvatar.mutate(f);
          }}
        />
      </div>

      <p className="mt-4 text-[11.5px] opacity-50">
        Signed in as {props.email} · permanent code {props.userCode}
      </p>
      {status && <p className="mt-2 text-sm font-semibold">{status}</p>}

      <div className="hr my-4" />
      <button
        className="btn btn-secondary btn-block !min-h-[42px]"
        onClick={() => signOut.mutate()}
      >
        Sign out
      </button>
      <button
        className="btn btn-block !min-h-[42px]"
        style={{
          borderColor: "var(--color-accent)",
          color: "var(--color-accent)",
          borderWidth: 1,
        }}
        disabled={busy}
        onClick={() => {
          if (!confirmDelete) return setConfirmDelete(true);
          deleteAccount.mutate();
        }}
      >
        {confirmDelete
          ? "Tap again to permanently delete everything"
          : "Delete account"}
      </button>
    </div>
  );
}
