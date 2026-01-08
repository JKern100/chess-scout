"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminRedirect } from "@/hooks/useAdminGuard";

type ApiResponse = {
  value: string;
  updated_at: string | null;
};

export function AdminAiPrompt() {
  const { isAdmin, isLoading } = useAdminRedirect();
  const [value, setValue] = useState<string>("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchPrompt = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/ai-prompt");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load prompt (${res.status})`);
      }
      const data = (await res.json()) as ApiResponse;
      setValue(data.value ?? "");
      setSavedAt(data.updated_at ?? null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    }
  }, []);

  useEffect(() => {
    if (isAdmin && !loaded) {
      void fetchPrompt();
    }
  }, [isAdmin, loaded, fetchPrompt]);

  const onSave = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/admin/ai-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save prompt (${res.status})`);
      }
      const data = (await res.json()) as ApiResponse;
      setValue(data.value ?? value);
      setSavedAt(data.updated_at ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prompt");
    } finally {
      setBusy(false);
    }
  }, [value]);

  const updatedLabel = useMemo(() => {
    if (!savedAt) return "Not saved yet";
    return `Last saved: ${new Date(savedAt).toLocaleString()}`;
  }, [savedAt]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-sm text-zinc-500">Loading…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-50 pb-12">
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1 className="text-xl font-semibold text-zinc-900">AI Prompt</h1>
          <p className="mt-1 text-sm text-zinc-500">Edit the Gemini system instruction used for profile narratives. Leave blank to use the built-in default.</p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pt-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-zinc-500">{updatedLabel}</div>
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>

          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="(Blank = use default)"
            className="min-h-[520px] w-full rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-900 outline-none focus:border-zinc-300"
          />

          <div className="mt-3 text-xs text-zinc-500">
            Changes apply to new generations after a short cache (~60s) expires.
          </div>
        </div>
      </div>
    </div>
  );
}
