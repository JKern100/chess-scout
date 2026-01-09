"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminRedirect } from "@/hooks/useAdminGuard";

type ApiResponse = {
  enabled: boolean;
  message: string;
  updated_at: string | null;
};

export function AdminMaintenance() {
  const { isAdmin, isLoading } = useAdminRedirect();
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/maintenance");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to load maintenance settings (${res.status})`);
      }
      const data = (await res.json()) as ApiResponse;
      setEnabled(Boolean(data.enabled));
      setMessage(String(data.message ?? ""));
      setSavedAt(data.updated_at ?? null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load maintenance settings");
    }
  }, []);

  useEffect(() => {
    if (isAdmin && !loaded) {
      void fetchState();
    }
  }, [isAdmin, loaded, fetchState]);

  const onSave = useCallback(async () => {
    try {
      setBusy(true);
      setError(null);
      const res = await fetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save maintenance settings (${res.status})`);
      }
      const data = (await res.json()) as ApiResponse;
      setEnabled(Boolean(data.enabled));
      setMessage(String(data.message ?? message));
      setSavedAt(data.updated_at ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save maintenance settings");
    } finally {
      setBusy(false);
    }
  }, [enabled, message]);

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
          <h1 className="text-xl font-semibold text-zinc-900">Maintenance Mode</h1>
          <p className="mt-1 text-sm text-zinc-500">
            When enabled, non-admin users will see a maintenance screen across the app.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pt-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
            <div>
              <div className="text-sm font-medium text-zinc-900">Maintenance mode</div>
              <div className="text-xs text-zinc-500">Show maintenance screen to non-admin users</div>
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              <span className="text-sm text-zinc-700">Enabled</span>
            </label>
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-zinc-900">Message (optional)</div>
            <div className="mt-1 text-xs text-zinc-500">
              This will be shown to users on the maintenance screen.
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. We’re upgrading report generation and imports. Check back in ~30 minutes."
              className="mt-3 min-h-[140px] w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-900 outline-none focus:border-zinc-300"
            />
          </div>

          <div className="mt-4 text-xs text-zinc-500">
            Tip: keep a browser window open as admin so you can turn this back off.
          </div>
        </div>
      </div>
    </div>
  );
}
