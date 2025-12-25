"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ImportRow = {
  id: string;
  target_type: "self" | "opponent";
  platform: "lichess" | "chesscom";
  username: string;
  status: "idle" | "running" | "stopped" | "complete" | "error";
  imported_count: number;
  last_game_at: string | null;
  cursor_until: string | null;
  last_error: string | null;
  updated_at: string;
};

type Props = {
  selfUsername?: string | null;
  selfPlatform?: string | null;
};

export function ImportPanel({ selfUsername, selfPlatform }: Props) {
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [opponentPlatform, setOpponentPlatform] = useState<"lichess" | "chesscom">("lichess");
  const [opponentUsername, setOpponentUsername] = useState<string>("");
  const [activeImportId, setActiveImportId] = useState<string | null>(null);

  const selfImport = useMemo(() => {
    return imports.find(
      (i) => i.target_type === "self" && i.platform === "lichess" && i.username === selfUsername
    );
  }, [imports, selfUsername]);

  const pollTimer = useRef<number | null>(null);

  async function refresh() {
    const res = await fetch("/api/imports/status", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Failed to load import status");
    setImports(json.imports ?? []);
  }

  async function runOpponentImport(imp: ImportRow) {
    setLoading(true);
    setStatus(null);
    try {
      if (imp.platform !== "lichess") {
        throw new Error("Opponent imports currently support Lichess only");
      }

      const res = await fetch("/api/imports/lichess/opponent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: imp.platform, username: imp.username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to run opponent import");

      setActiveImportId(json?.import?.id ?? imp.id);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to run opponent import");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pollTimer.current) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }

    const active = activeImportId ? imports.find((i) => i.id === activeImportId) : null;
    const running =
      active?.status === "running"
        ? active
        : selfImport?.status === "running"
          ? selfImport
          : null;

    if (running) {
      pollTimer.current = window.setTimeout(() => {
        void continueImport(running.id);
      }, 400);
    }

    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imports, activeImportId, selfImport?.status, selfImport?.imported_count, selfImport?.cursor_until]);

  async function startImport() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/imports/lichess/start", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to start import");
      setActiveImportId(json?.import?.id ?? null);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to start import");
    } finally {
      setLoading(false);
    }
  }

  async function startOpponentImport() {
    setLoading(true);
    setStatus(null);
    try {
      if (opponentPlatform !== "lichess") {
        throw new Error("Opponent imports currently support Lichess only");
      }

      const res = await fetch("/api/imports/lichess/opponent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: opponentPlatform, username: opponentUsername }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to start opponent import");
      setActiveImportId(json?.import?.id ?? null);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to start opponent import");
    } finally {
      setLoading(false);
    }
  }

  async function continueImport(importId: string) {
    try {
      const res = await fetch("/api/imports/lichess/continue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ import_id: importId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to continue import");

      setStatus(null);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to continue import");
    }
  }

  async function stopImport(importId: string) {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/imports/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ import_id: importId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to stop import");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to stop import");
    } finally {
      setLoading(false);
    }
  }

  const disabledReason =
    selfPlatform !== "lichess"
      ? "Import currently supports Lichess only"
      : !selfUsername
        ? "Connect your Lichess username first"
        : null;

  const opponentImports = useMemo(() => {
    return imports
      .filter((i) => i.target_type === "opponent")
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }, [imports]);

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="text-lg font-medium text-zinc-900">Import games</div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-base font-medium text-zinc-900">Your games</div>
              <div className="mt-1 text-sm text-zinc-600">
                Imports your full Lichess game history in batches. You can stop any time.
              </div>
            </div>
            <div className="rounded-xl bg-zinc-50 px-3 py-2 text-right">
              <div className="text-xs text-zinc-500">Imported</div>
              <div className="text-base font-semibold text-zinc-900">
                {selfImport?.imported_count ?? 0}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              disabled={loading || !!disabledReason}
              onClick={startImport}
              title={disabledReason ?? undefined}
            >
              {selfImport?.status === "running" ? "Running…" : "Start / Resume"}
            </button>

            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={loading || !selfImport || selfImport.status !== "running"}
              onClick={() => (selfImport ? void stopImport(selfImport.id) : null)}
            >
              Stop
            </button>

            <div className="text-sm text-zinc-600">
              Status:{" "}
              <span className="font-medium text-zinc-900">{selfImport?.status ?? "idle"}</span>
            </div>
          </div>

          {selfImport?.last_game_at ? (
            <div className="text-sm text-zinc-600">
              Oldest loaded game: {new Date(selfImport.last_game_at).toLocaleString()}
            </div>
          ) : null}

          {selfImport?.last_error ? (
            <div className="text-sm text-red-600">{selfImport.last_error}</div>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5">
          <div>
            <div className="text-base font-medium text-zinc-900">Opponent</div>
            <div className="mt-1 text-sm text-zinc-600">
              Enter an opponent username to import their games for scouting.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-900" htmlFor="opp-platform">
                Platform
              </label>
              <select
                id="opp-platform"
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                value={opponentPlatform}
                onChange={(e) => setOpponentPlatform(e.target.value as any)}
              >
                <option value="lichess">Lichess</option>
                <option value="chesscom">Chess.com</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-900" htmlFor="opp-username">
                Username
              </label>
              <input
                id="opp-username"
                className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                value={opponentUsername}
                onChange={(e) => setOpponentUsername(e.target.value)}
                placeholder={opponentPlatform === "lichess" ? "lichess_username" : "chesscom_username"}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              disabled={loading || !opponentUsername.trim()}
              onClick={startOpponentImport}
            >
              Start
            </button>

            <button
              type="button"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>

          {opponentImports.length ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-zinc-900">Recent opponent imports</div>
              {opponentImports.slice(0, 5).map((imp) => (
                <div
                  key={imp.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-zinc-900">
                      {imp.platform} / {imp.username}
                    </div>
                    <div className="text-xs text-zinc-600">
                      status: {imp.status} · imported: {imp.imported_count}
                    </div>
                    {imp.last_error ? (
                      <div className="text-xs text-red-600">{imp.last_error}</div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      disabled={loading || imp.status !== "running"}
                      onClick={() => void stopImport(imp.id)}
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                      disabled={loading}
                      onClick={() => {
                        void runOpponentImport(imp);
                      }}
                    >
                      Run
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {status ? <div className="text-sm text-zinc-600">{status}</div> : null}
    </div>
  );
}
