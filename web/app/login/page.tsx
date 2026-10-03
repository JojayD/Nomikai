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
  const [code, setCode] = useState("");

  const goHome = () => {
    router.replace("/");
    router.refresh();
  };

  const sendCode = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCode("");
      setMode("sent");
    },
  });

  const verifyCode = useMutation({
    mutationFn: async () => {
      if (!/^[0-9]{6}$/.test(code)) {
        throw new Error("Enter the 6-digit code from your email.");
      }
      const { error } = await createClient().auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (error) throw error;
    },
    onSuccess: goHome,
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
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      // A session comes back immediately when email confirmation is off.
      if (data.session) return goHome();
      setCode("");
      setMode("sent");
    },
  });

  // One error line serves all auth paths. Retrying clears that mutation's own
  // error; switching paths has to clear the others.
  const all = [sendCode, verifyCode, signInWithPassword, createAccount];
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
              Enter the 6-digit code we emailed to <strong>{email}</strong>.
            </p>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                resetErrors();
                verifyCode.mutate();
              }}
            >
              <div className="field">
                <label htmlFor="code">6-digit code</label>
                <input
                  id="code"
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  disabled={busy}
                  autoFocus
                  required
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
                {verifyCode.isPending ? "Verifying…" : "Verify code"}
              </button>
            </form>
            <button
              type="button"
              className="btn btn-secondary btn-block"
              disabled={busy}
              onClick={() => {
                resetErrors();
                sendCode.mutate();
              }}
            >
              {sendCode.isPending ? "Sending…" : "Resend code"}
            </button>
            <p className="mt-2 text-xs opacity-60">
              You may need to wait a minute before requesting another code.
            </p>
            <button
              type="button"
              className="btn btn-ghost mt-3 text-sm"
              disabled={busy}
              onClick={() => {
                resetErrors();
                setCode("");
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
              if (busy) return;
              resetErrors();
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
                disabled={busy}
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
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === "email" ? (
              <>
                <button className="btn btn-primary btn-block" disabled={busy}>
                  {sendCode.isPending ? "Sending…" : "Email me a code"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  disabled={busy}
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
                  onClick={() => {
                    resetErrors();
                    createAccount.mutate();
                  }}
                >
                  Create account with this password
                </button>
                <button
                  type="button"
                  className="btn btn-ghost mt-3 text-sm"
                  disabled={busy}
                  onClick={() => {
                    resetErrors();
                    setMode("email");
                  }}
                >
                  Email me a code instead
                </button>
              </>
            )}
          </form>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold" style={{ color: "var(--color-accent)" }}>
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
