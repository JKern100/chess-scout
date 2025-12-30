"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { useImportsRealtime } from "@/lib/hooks/useImportsRealtime";
import { createOpeningGraphImporter, type OpeningGraphImportStatus } from "@/lib/openingGraphImport/openingGraphImportService";

type ChessPlatform = "lichess" | "chesscom";

type OpponentRow = {
  platform: ChessPlatform;
  username: string;
  created_at: string;
  last_refreshed_at: string | null;
  games_count?: number;
};

type SavedLineRow = {
  id: string;
  opponent_id: string | null;
  opponent_platform: ChessPlatform | null;
  opponent_username: string | null;
  mode: "simulation" | "analysis";
  platform: ChessPlatform | null;
  starting_fen: string;
  moves_san: string[];
  final_fen: string;
  name: string;
  notes: string | null;
  saved_at: string;
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

function formatSavedLineDate(iso: string) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const day = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (day >= 0 && day <= 7) return formatRelative(iso);
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function DashboardPage({ initialOpponents }: Props) {
  const MIN_GAMES_FOR_ANALYSIS = 10;
  const [opponents, setOpponents] = useState<OpponentRow[]>(initialOpponents);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fastStatus, setFastStatus] = useState<OpeningGraphImportStatus>({
    phase: "idle",
    gamesProcessed: 0,
    bytesRead: 0,
    lastError: null,
  });
  const [fastTargetKey, setFastTargetKey] = useState<string | null>(null);
  const fastImporterRef = useRef<ReturnType<typeof createOpeningGraphImporter> | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [displayIndexedCount, setDisplayIndexedCount] = useState(0);
  const [indeterminateArmed, setIndeterminateArmed] = useState(false);

  const { imports } = useImportsRealtime();

  const [savedLinesOpen, setSavedLinesOpen] = useState<Record<string, boolean>>({});
  const [savedLinesByOpponent, setSavedLinesByOpponent] = useState<Record<string, SavedLineRow[]>>({});
  const [savedLinesBusy, setSavedLinesBusy] = useState<Record<string, boolean>>({});
  const [savedLinesError, setSavedLinesError] = useState<Record<string, string | null>>({});

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
        indexedCount: number;
        ready: boolean;
        stage: string;
        status: string;
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

  async function startFastImport(o: OpponentRow) {
    if (loading) return;
    if (o.platform !== "lichess") {
      setStatus("Fast import currently supports Lichess only");
      return;
    }

    const key = `${o.platform}:${o.username.toLowerCase()}`;
    setFastTargetKey(key);
    setStatus(null);

    if (!fastImporterRef.current) {
      fastImporterRef.current = createOpeningGraphImporter({
        onStatus: (s) => setFastStatus(s),
      });
    }

    try {
      await fastImporterRef.current.start({
        platform: "lichess",
        username: o.username,
        color: "both",
        rated: "any",
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to start fast import");
    }
  }

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

  async function addOpponentAndFastImport() {
    setLoading(true);
    setStatus(null);
    try {
      const trimmed = username.trim();
      if (!trimmed) throw new Error("Username is required");
      if (platform !== "lichess") throw new Error("Fast import currently supports Lichess only");

      const res = await fetch("/api/opponents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, username: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to add opponent");

      await reloadOpponents();
      setUsername("");

      await startFastImport({
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
      const initialIndexed = Number(json?.import?.archived_count ?? 0);
      const initialReady = Boolean(json?.import?.ready);
      const initialStage = String(json?.import?.stage ?? "indexing");
      const initialStatus = String(json?.import?.status ?? "running");

      activeImportRef.current = { id: importId, username: o.username, platform: o.platform };
      setActiveImport({
        id: importId,
        platform: o.platform,
        username: o.username,
        importedCount: initialImported,
        indexedCount: initialIndexed,
        ready: initialReady,
        stage: initialStage,
        status: initialStatus,
      });
      setImportModalOpen(true);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      activeImportRef.current = null;
      setActiveImport(null);
      setContinueBusy(false);
      setLoading(false);
    }
  }

  const importsByKey = useMemo(() => {
    const m = new Map<string, (typeof imports)[number]>();
    for (const i of imports) {
      if (i.target_type !== "opponent") continue;
      m.set(`${i.platform}:${i.username.toLowerCase()}`, i);
    }
    return m;
  }, [imports]);

  function formatTieredStatus(imp: any, isActive: boolean) {
    if (!imp) return null;
    if (String(imp.status ?? "") !== "running" && !imp.ready) return null;

    const ready = Boolean(imp.ready);
    const stage = String(imp.stage ?? "");
    const indexed = typeof imp.archived_count === "number" ? imp.archived_count : 0;

    if (ready && stage === "archiving") return "Scouting 1,000 games (Archiving history...)";
    if (ready) return "Scout ready";

    const capped = Math.min(indexed, 1000);
    const base = `Indexing: ${capped} / 1000`;
    return isActive && continueBusy ? `${base} (Fetching games...)` : base;
  }

  function prepare(o: OpponentRow) {
    try {
      if (o.platform === "lichess") {
        window.localStorage.setItem("chessscout.opponent.lichess", o.username);
      }
    } catch {
      // ignore
    }
    window.location.href = "/play?mode=analysis";
  }

  const activeReady = Boolean(activeImport?.ready);
  const activeStage = String(activeImport?.stage ?? "");
  const activeStatus = String(activeImport?.status ?? "");
  const activeIndexedCapped = Math.min(Number(activeImport?.indexedCount ?? 0), 1000);
  const activePct = Math.max(0, Math.min(100, Math.round((activeIndexedCapped / 1000) * 100)));
  const activeIndeterminate = indeterminateArmed && !activeReady && activeIndexedCapped === 0 && continueBusy;
  const activeCanAnalyze = (activeImport?.importedCount ?? 0) >= MIN_GAMES_FOR_ANALYSIS;

  useEffect(() => {
    if (!importModalOpen || !activeImport) {
      setIndeterminateArmed(false);
      return;
    }

    setIndeterminateArmed(false);
    const id = window.setTimeout(() => setIndeterminateArmed(true), 600);
    return () => window.clearTimeout(id);
  }, [activeImport, importModalOpen]);

  useEffect(() => {
    if (!importModalOpen || !activeImport) return;
    setDisplayIndexedCount((prev) => {
      const next = Math.min(Math.max(prev, 0), 1000);
      if (next > activeIndexedCapped) return activeIndexedCapped;
      return next;
    });
  }, [activeIndexedCapped, activeImport, importModalOpen]);

  useEffect(() => {
    if (!importModalOpen || !activeImport) return;
    if (activeIndeterminate) return;
    if (displayIndexedCount >= activeIndexedCapped) return;

    const id = window.setInterval(() => {
      setDisplayIndexedCount((prev) => {
        if (prev >= activeIndexedCapped) return prev;
        const remaining = activeIndexedCapped - prev;
        const step = Math.max(1, Math.min(8, Math.ceil(remaining / 12)));
        return Math.min(activeIndexedCapped, prev + step);
      });
    }, 60);

    return () => window.clearInterval(id);
  }, [activeImport, activeIndexedCapped, activeIndeterminate, displayIndexedCount, importModalOpen]);

  const activeTitle = activeImport
    ? `Importing ${activeImport.username} from ${activeImport.platform === "lichess" ? "Lichess" : "Chess.com"}`
    : "Import";

  const activeSubtitle = useMemo(() => {
    if (!activeImport) return null;
    if (activeStatus === "complete" || activeStage === "complete") return "Import complete.";
    if (activeReady && activeStage === "archiving") return "Archiving history in the background.";
    if (activeReady) return "Ready to analyze.";
    return "Indexing your first 1,000 games (unlocks analysis).";
  }, [activeImport, activeReady, activeStage, activeStatus]);

  const activeExplain = useMemo(() => {
    if (!activeImport) return null;
    if (activeReady) return "You can close this window and start analyzing or create a profile.";
    return "Once the first 1,000 games are indexed, you can close this window and start analyzing.";
  }, [activeImport, activeReady]);

  useMemo(() => {
    if (!importModalOpen) return null;
    if (!activeImport) return null;
    if (!(activeStatus === "complete" || activeStage === "complete")) return null;
    const id = window.setTimeout(() => setImportModalOpen(false), 1000);
    return () => window.clearTimeout(id);
  }, [activeImport, activeStage, activeStatus, importModalOpen]);

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
                  Import (Legacy)
                </button>

                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                  disabled={loading || !username.trim() || platform !== "lichess"}
                  onClick={addOpponentAndFastImport}
                  title={platform !== "lichess" ? "Fast import currently supports Lichess only" : "Fast Import (beta): streams from Lichess and writes aggregated opening graph"}
                >
                  Fast Import
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
                {continueBusy ? <span className="text-zinc-500"> · Fetching games…</span> : null}
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

          {importModalOpen && activeImport ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
              <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-lg">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-zinc-900">{activeTitle}</div>
                    {activeSubtitle ? <div className="mt-1 text-xs text-zinc-600">{activeSubtitle}</div> : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                    onClick={() => {
                      if (!activeReady) {
                        const ok = window.confirm(
                          "Indexing is still in progress. You can close this window now, but analysis will remain locked until the first 1,000 games are indexed."
                        );
                        if (!ok) return;
                      }
                      setImportModalOpen(false);
                    }}
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 grid gap-4">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between text-xs text-zinc-700">
                      <div className="font-medium text-zinc-900">Downloading games</div>
                      <div className="tabular-nums">{activeImport.importedCount}</div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                      {indeterminateArmed && continueBusy ? (
                        <div className="h-full w-full bg-zinc-900/20 animate-pulse" />
                      ) : (
                        <div className="h-full bg-zinc-900" style={{ width: "0%" }} />
                      )}
                    </div>
                    <div className="text-xs text-zinc-600">{continueBusy ? "Fetching games…" : "Queued…"}</div>
                  </div>

                  <div className="grid gap-2">
                    <div className="flex items-center justify-between text-xs text-zinc-700">
                      <div className="font-medium text-zinc-900">Indexing first 1,000 games (unlocks analysis)</div>
                      <div className="tabular-nums">{activeIndeterminate ? 0 : displayIndexedCount} / 1000</div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                      {activeIndeterminate ? (
                        <div className="h-full w-full bg-zinc-900/20 animate-pulse" />
                      ) : (
                        <div
                          className="h-full bg-zinc-900"
                          style={{ width: `${Math.max(0, Math.min(100, Math.round(((activeIndeterminate ? 0 : displayIndexedCount) / 1000) * 100)))}%` }}
                        />
                      )}
                    </div>
                    <div className="text-xs text-zinc-600">{activeReady ? "Ready" : continueBusy ? "Indexing…" : "Waiting for next batch…"}</div>
                  </div>
                </div>

                {activeExplain ? <div className="mt-3 text-xs leading-5 text-zinc-700">{activeExplain}</div> : null}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                    disabled={!activeImport || loading}
                    onClick={() =>
                      void stopImport(activeImport.id)
                        .then(() => {
                          setStatus("Stopping import...");
                        })
                        .catch((e) => {
                          setStatus(e instanceof Error ? e.message : "Failed to stop import");
                        })
                    }
                  >
                    Cancel import
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
                      disabled={!activeCanAnalyze}
                      title={activeCanAnalyze ? undefined : `Waiting for ${MIN_GAMES_FOR_ANALYSIS} games to download...`}
                      onClick={() => prepare({ platform: activeImport.platform, username: activeImport.username, created_at: "", last_refreshed_at: null })}
                    >
                      Analyze
                    </button>
                    <Link
                      href={`/opponents/${encodeURIComponent(activeImport.platform)}/${encodeURIComponent(activeImport.username)}/profile`}
                      className={`inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 ${
                        activeCanAnalyze ? "" : "pointer-events-none opacity-60"
                      }`}
                      title={activeCanAnalyze ? undefined : `Waiting for ${MIN_GAMES_FOR_ANALYSIS} games to download...`}
                    >
                      Create Profile
                    </Link>
                  </div>
                </div>
              </div>
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

              const importRow = importsByKey.get(key) ?? null;
              const tieredStatus = formatTieredStatus(importRow as any, isActive);
              const downloadedCount = typeof (importRow as any)?.imported_count === "number" ? (importRow as any).imported_count : 0;
              const recordsCountBase = typeof latest.games_count === "number" ? latest.games_count : 0;
              const fastCountLive = fastTargetKey === key ? Math.max(0, Number(fastStatus.gamesProcessed ?? 0)) : 0;
              const importedGamesCount = Math.max(recordsCountBase, downloadedCount, fastCountLive);
              const canUseScout = downloadedCount >= MIN_GAMES_FOR_ANALYSIS || isActive;

              const isSavedOpen = Boolean(savedLinesOpen[key]);
              const savedLines = savedLinesByOpponent[key] ?? null;
              const isSavedBusy = Boolean(savedLinesBusy[key]);
              const savedErr = savedLinesError[key] ?? null;

              async function toggleSavedLines() {
                const next = !Boolean(savedLinesOpen[key]);
                setSavedLinesOpen((prev) => ({ ...prev, [key]: next }));
                if (!next) return;
                if (savedLinesByOpponent[key]) return;

                setSavedLinesBusy((prev) => ({ ...prev, [key]: true }));
                setSavedLinesError((prev) => ({ ...prev, [key]: null }));
                try {
                  const qs = new URLSearchParams({
                    opponent_platform: latest.platform,
                    opponent_username: latest.username,
                  });
                  const res = await fetch(`/api/saved-lines?${qs.toString()}`, { cache: "no-store" });
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(String((json as any)?.error ?? "Failed to load saved lines"));
                  const lines = Array.isArray((json as any)?.saved_lines)
                    ? ((json as any).saved_lines as SavedLineRow[])
                    : [];
                  setSavedLinesByOpponent((prev) => ({ ...prev, [key]: lines }));
                } catch (e) {
                  setSavedLinesError((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : "Failed to load" }));
                } finally {
                  setSavedLinesBusy((prev) => ({ ...prev, [key]: false }));
                }
              }

              return (
                <div key={key} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                          {latest.platform === "lichess" ? "Lichess" : "Chess.com"}
                        </span>
                        <div className="truncate text-sm font-medium text-zinc-900">{latest.username}</div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-600">
                        Imported games: {importedGamesCount} · Last refreshed:{" "}
                        <span suppressHydrationWarning>
                          {latest.last_refreshed_at ? formatRelative(latest.last_refreshed_at) : "never"}
                        </span>
                      </div>
                      {isActive ? (
                        <div className="mt-1 text-xs font-medium text-zinc-700">
                          Importing · imported: {activeImport?.importedCount ?? 0}
                        </div>
                      ) : null}

                      {tieredStatus ? (
                        <div className="mt-1 text-xs text-zinc-700">{tieredStatus}</div>
                      ) : null}

                      {fastTargetKey === key && fastStatus.phase !== "idle" ? (
                        <div className="mt-1 text-xs text-zinc-700">
                          Fast import: <span className="font-medium">{fastStatus.phase}</span> · games: {fastStatus.gamesProcessed}
                          {fastStatus.lastError ? <span className="text-red-600"> · {fastStatus.lastError}</span> : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/opponents/${encodeURIComponent(latest.platform)}/${encodeURIComponent(latest.username)}/profile`}
                        className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                      >
                        Profile
                      </Link>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                        disabled={loading || !canUseScout}
                        title={canUseScout ? undefined : `Waiting for ${MIN_GAMES_FOR_ANALYSIS} games to download...`}
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
                        disabled={loading || fastStatus.phase === "running"}
                        onClick={() => void startFastImport(latest)}
                        title="Fast Import (beta): streams from Lichess and writes aggregated opening graph"
                      >
                        Fast Import
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

                  <div className="mt-3 border-t border-zinc-100 pt-3">
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-xs font-medium text-zinc-900"
                      onClick={() => void toggleSavedLines()}
                    >
                      <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700">
                        Saved Lines
                      </span>
                      <span className="text-zinc-500">{isSavedOpen ? "Hide" : "Show"}</span>
                    </button>

                    {isSavedOpen ? (
                      <div className="mt-3 grid gap-2">
                        {isSavedBusy ? (
                          <div className="text-xs text-zinc-600">Loading…</div>
                        ) : savedErr ? (
                          <div className="text-xs text-zinc-600">{savedErr}</div>
                        ) : savedLines && savedLines.length === 0 ? (
                          <div className="text-xs text-zinc-600">No saved lines yet.</div>
                        ) : savedLines ? (
                          <div className="grid gap-2">
                            {savedLines.map((sl) => (
                              <div
                                key={sl.id}
                                className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2"
                              >
                                <div className="w-[56px] shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white">
                                  <Chessboard
                                    options={{
                                      position: sl.final_fen,
                                      allowDrawingArrows: false,
                                      showNotation: false,
                                      boardOrientation: "white",
                                      animationDurationInMs: 0,
                                      boardStyle: {
                                        width: 56,
                                        height: 56,
                                        display: "grid",
                                        gridTemplateColumns: "repeat(8, 7px)",
                                        gridTemplateRows: "repeat(8, 7px)",
                                        gap: 0,
                                        lineHeight: 0,
                                        borderRadius: 0,
                                      },
                                      squareStyle: {
                                        width: 7,
                                        height: 7,
                                        lineHeight: 0,
                                      },
                                    }}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <div className="truncate text-xs font-medium text-zinc-900">{sl.name}</div>
                                    <div className="shrink-0 text-[10px] text-zinc-500" suppressHydrationWarning>
                                      {formatSavedLineDate(sl.saved_at)}
                                    </div>
                                  </div>
                                  {sl.notes ? (
                                    <div className="mt-1 text-xs text-zinc-600 line-clamp-2">{sl.notes}</div>
                                  ) : null}

                                  <div className="mt-2 flex items-center gap-2">
                                    <Link
                                      href={`/play?mode=analysis&saved_line_id=${encodeURIComponent(sl.id)}`}
                                      className="inline-flex h-7 items-center justify-center rounded-lg bg-zinc-900 px-2.5 text-[10px] font-semibold text-white hover:bg-zinc-800"
                                    >
                                      Analyze
                                    </Link>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
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
