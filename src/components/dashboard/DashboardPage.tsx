"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

type ChessPlatform = "lichess" | "chesscom";

type OpponentRow = {
  platform: ChessPlatform;
  username: string;
  created_at: string;
  last_refreshed_at: string | null;
  games_count?: number;
};

type Props = {
  initialOpponents: OpponentRow[];
};

function formatRelative(iso: string) {
  const ts = new Date(iso).getTime();
  const diffMs = Date.now() - ts;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return `${sec}s ago`;
  if (min < 60) return `${min}m ago`;
  if (hr < 48) return `${hr}h ago`;
  return `${day}d ago`;
}

export function DashboardPage({ initialOpponents }: Props) {
  const [opponents, setOpponents] = useState<OpponentRow[]>(initialOpponents);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [platform, setPlatform] = useState<ChessPlatform>("lichess");
  const [username, setUsername] = useState<string>("");

  const activeImportRef = useRef<{ id: string; username: string; platform: ChessPlatform } | null>(null);
  const stopRequestedRef = useRef(false);
  const [activeImport, setActiveImport] = useState<
    | {
        id: string;
        platform: ChessPlatform;
        username: string;
        importedCount: number;
      }
    | null
  >(null);

  const byKey = useMemo(() => {
    const m = new Map<string, OpponentRow>();
    for (const o of opponents) {
      m.set(`${o.platform}:${o.username.toLowerCase()}`, o);
    }
    return m;
  }, [opponents]);

  async function reloadOpponents() {
    const res = await fetch("/api/opponents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Failed to load opponents");
    setOpponents(Array.isArray(json?.opponents) ? (json.opponents as OpponentRow[]) : []);
  }

  async function addOpponent() {
    setLoading(true);
    setStatus(null);
    try {
      const trimmed = username.trim();
      if (!trimmed) throw new Error("Username is required");

      const res = await fetch("/api/opponents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, username: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to add opponent");

      await reloadOpponents();
      setUsername("");
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to add opponent");
    } finally {
      setLoading(false);
    }
  }

  async function addOpponentAndImport() {
    setLoading(true);
    setStatus(null);
    try {
      const trimmed = username.trim();
      if (!trimmed) throw new Error("Username is required");

      const res = await fetch("/api/opponents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, username: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to add opponent");

      await reloadOpponents();
      setUsername("");

      await startRefresh({
        platform,
        username: trimmed,
        created_at: new Date().toISOString(),
        last_refreshed_at: null,
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to add opponent");
    } finally {
      setLoading(false);
    }
  }

  async function continueImport(importId: string) {
    const res = await fetch("/api/imports/lichess/continue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ import_id: importId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Import failed");
    return json;
  }

  async function stopImport(importId: string) {
    stopRequestedRef.current = true;
    const res = await fetch("/api/imports/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ import_id: importId }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Failed to stop import");
    return json;
  }

  async function deleteOpponent(o: OpponentRow) {
    if (loading) return;
    if (activeImport && activeImport.platform === o.platform && activeImport.username.toLowerCase() === o.username.toLowerCase()) {
      setStatus("Stop the active import before deleting this opponent.");
      return;
    }

    const ok = window.confirm(
      `Delete ${o.platform === "lichess" ? "Lichess" : "Chess.com"} opponent '${o.username}'?\n\nImported games will be kept and reused if you add them back.`
    );
    if (!ok) return;

    setLoading(true);
    setStatus(null);
    try {
      const qs = new URLSearchParams({ platform: o.platform, username: o.username });
      const res = await fetch(`/api/opponents?${qs.toString()}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to delete opponent");
      await reloadOpponents();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to delete opponent");
    } finally {
      setLoading(false);
    }
  }

  async function startRefresh(o: OpponentRow) {
    stopRequestedRef.current = false;
    setLoading(true);
    setStatus(null);

    try {
      if (o.platform !== "lichess") {
        setStatus("Chess.com refresh coming soon");
        return;
      }

      const res = await fetch("/api/imports/lichess/opponent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: o.platform, username: o.username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to start import");

      const importId = String(json?.import?.id ?? "");
      if (!importId) throw new Error("Import did not return an id");

      const initialImported = Number(json?.import?.imported_count ?? 0);

      activeImportRef.current = { id: importId, username: o.username, platform: o.platform };
      setActiveImport({ id: importId, platform: o.platform, username: o.username, importedCount: initialImported });

      // Poll until complete/error/stopped.
      for (;;) {
        if (stopRequestedRef.current) break;
        const step = await continueImport(importId);
        const status = String(step?.import?.status ?? "");
        const importedCount = Number(step?.import?.imported_count ?? initialImported);
        setActiveImport({ id: importId, platform: o.platform, username: o.username, importedCount });
        if (status && status !== "running") break;
        await new Promise((r) => window.setTimeout(r, 500));
      }

      await reloadOpponents();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      activeImportRef.current = null;
      setActiveImport(null);
      setLoading(false);
    }
  }

  function prepare(o: OpponentRow) {
    try {
      if (o.platform === "lichess") {
        window.localStorage.setItem("chessscout.opponent.lichess", o.username);
      }
    } catch {
      // ignore
    }
    window.location.href = "/play";
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-zinc-600">ChessScout</div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
          </div>
          <Link
            href="/"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Home
          </Link>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-lg font-medium text-zinc-900">Opponents</div>
              <div className="mt-1 text-sm text-zinc-600">Add opponents and manually refresh their games.</div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-900" htmlFor="dash-platform">
                  Platform
                </label>
                <select
                  id="dash-platform"
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as any)}
                  disabled={loading}
                >
                  <option value="lichess">Lichess</option>
                  <option value="chesscom">Chess.com</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-zinc-900" htmlFor="dash-username">
                  Username
                </label>
                <input
                  id="dash-username"
                  className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={platform === "lichess" ? "lichess_username" : "chesscom_username"}
                  disabled={loading}
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                  disabled={loading || !username.trim()}
                  onClick={addOpponent}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                  disabled={loading || !username.trim()}
                  onClick={addOpponentAndImport}
                  title={platform !== "lichess" ? "Chess.com import coming soon" : undefined}
                >
                  Import
                </button>
              </div>
            </div>
          </div>

          {status ? <div className="mt-4 text-sm text-zinc-600">{status}</div> : null}

          {activeImport ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
              <div className="text-sm text-zinc-700">
                Importing <span className="font-medium text-zinc-900">{activeImport.username}</span> · imported:{" "}
                <span className="font-semibold text-zinc-900">{activeImport.importedCount}</span>
              </div>
              <button
                type="button"
                className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                disabled={!activeImport || loading === false}
                onClick={() =>
                  activeImport
                    ? void stopImport(activeImport.id)
                        .then(() => {
                          setStatus("Stopping import...");
                        })
                        .catch((e) => {
                          setStatus(e instanceof Error ? e.message : "Failed to stop import");
                        })
                    : null
                }
              >
                Stop
              </button>
            </div>
          ) : null}

          <div className="mt-6 grid gap-3">
            {opponents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
                No opponents yet.
              </div>
            ) : null}

            {opponents.map((o) => {
              const key = `${o.platform}:${o.username.toLowerCase()}`;
              const latest = byKey.get(key) ?? o;
              const isActive = Boolean(
                activeImport &&
                  activeImport.platform === latest.platform &&
                  activeImport.username.toLowerCase() === latest.username.toLowerCase()
              );
              return (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                        {latest.platform === "lichess" ? "Lichess" : "Chess.com"}
                      </span>
                      <div className="truncate text-sm font-medium text-zinc-900">{latest.username}</div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      Records: {typeof latest.games_count === "number" ? latest.games_count : 0} · Last refreshed:{" "}
                      {latest.last_refreshed_at ? formatRelative(latest.last_refreshed_at) : "never"}
                    </div>
                    {isActive ? (
                      <div className="mt-1 text-xs font-medium text-zinc-700">
                        Importing · imported: {activeImport?.importedCount ?? 0}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                      disabled={loading}
                      onClick={() => prepare(latest)}
                    >
                      Prepare
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      disabled={loading}
                      onClick={() => void startRefresh(latest)}
                      title={latest.platform !== "lichess" ? "Chess.com refresh coming soon" : undefined}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      disabled={loading || isActive}
                      onClick={() => void deleteOpponent(latest)}
                      title={isActive ? "Stop import before deleting" : undefined}
                    >
                      Delete
                    </button>
                    {isActive ? (
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                        disabled={loading === false}
                        onClick={() =>
                          activeImport
                            ? void stopImport(activeImport.id)
                                .then(() => {
                                  setStatus("Stopping import...");
                                })
                                .catch((e) => {
                                  setStatus(e instanceof Error ? e.message : "Failed to stop import");
                                })
                            : null
                        }
                      >
                        Stop
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
