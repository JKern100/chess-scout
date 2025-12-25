"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Props = {
  userEmail?: string | null;
};

export function AuthPanel({ userEmail }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInWithEmail() {
    setLoading(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;

      setStatus("Check your email for a sign-in link.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Sign out failed");
    } finally {
      setLoading(false);
    }
  }

  if (userEmail) {
    return (
      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-zinc-700">Signed in as</div>
        <div className="truncate text-base font-medium text-zinc-900">{userEmail}</div>
        <button
          type="button"
          className="mt-2 inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          disabled={loading}
          onClick={signOut}
        >
          Sign out
        </button>
        {status ? <div className="text-sm text-zinc-600">{status}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <label className="text-sm font-medium text-zinc-900" htmlFor="email">
        Sign in
      </label>
      <input
        id="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
      />
      <button
        type="button"
        className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        disabled={loading || !email}
        onClick={signInWithEmail}
      >
        Send magic link
      </button>
      {status ? <div className="text-sm text-zinc-600">{status}</div> : null}
    </div>
  );
}
