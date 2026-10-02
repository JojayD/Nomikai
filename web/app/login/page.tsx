"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "email" | "password" | "sent";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const goHome = () => {
    router.push("/");
    router.refresh();
  };

  const sendCode = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${location.origin}/auth/confirm`,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => setMode("sent"),
  });

  const signInWithPassword = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
    },
    onSuccess: goHome,
  });

  const createAccount = useMutation({
    mutationFn: async () => {
      const { data, error } = await createClient().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/confirm` },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // A session comes back immediately when email confirmation is off.
      if (data.session) return goHome();
      setMode("sent");
    },
  });

  // One error line serves all three paths. Retrying clears that mutation's own
  // error; switching paths has to clear the other two.
  const all = [sendCode, signInWithPassword, createAccount];
  const busy = all.some((m) => m.isPending);
  const error = all.find((m) => m.error)?.error;
  const resetErrors = () => all.forEach((m) => m.reset());

  return (
    <main className="flex flex-1 flex-col">
      <div className="border-b-2 px-5 pt-10 pb-6" style={{ borderColor: "var(--color-divider)" }}>
        <h1 className="text-[44px] leading-[0.95] tracking-[-0.045em]">NOMIKAI</h1>
        <div className="kicker mt-2 !text-[12px] !tracking-[0.2em]">
          飲み会 · a drinking party
        </div>
        <p className="mt-4 text-[14.5px] opacity-80">
          Log what you drank, where, and when. See what your friends are
          trying. No install — it&apos;s a link.
        </p>
      </div>

      <div className="p-5">
        {mode === "sent" ? (
          <>
            <p className="text-sm opacity-80">
              We emailed <strong>{email}</strong> a link. Click it to
              continue.
            </p>
            <button
              type="button"
              className="btn btn-ghost mt-3 text-sm"
              onClick={() => {
                resetErrors();
                setMode("email");
              }}
            >
              Use a different email
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "email") sendCode.mutate();
              else signInWithPassword.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {mode === "password" && (
              <div className="field mt-3">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === "email" ? (
              <>
                <button className="btn btn-primary btn-block" disabled={busy}>
                  Email me a link
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() => {
                    resetErrors();
                    setMode("password");
                  }}
                >
                  Use a password instead
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-block" disabled={busy}>
                  Sign in
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  disabled={busy}
                  onClick={() => createAccount.mutate()}
                >
                  Create account with this password
                </button>
                <button
                  type="button"
                  className="btn btn-ghost mt-3 text-sm"
                  onClick={() => {
                    resetErrors();
                    setMode("email");
                  }}
                >
                  Email me a link instead
                </button>
              </>
            )}
          </form>
        )}

        {error && (
          <p className="mt-4 text-sm font-semibold" style={{ color: "var(--color-accent)" }}>
            {error.message}
          </p>
        )}
      </div>

      <div className="mt-auto px-5 pb-6">
        <div className="hr mb-4" />
        <p className="text-[11.5px] opacity-50">
          Nomikai ranks variety, not volume. Nothing here rewards drinking
          more. Non-alcoholic drinks count the same.
        </p>
      </div>
    </main>
  );
}
