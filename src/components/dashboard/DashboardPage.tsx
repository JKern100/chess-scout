"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { MoreVertical, Check, RefreshCw, LayoutGrid, List } from "lucide-react";
import { useRouter } from "next/navigation";
import { useImportsRealtime } from "@/lib/hooks/useImportsRealtime";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useImportQueue } from "@/context/ImportQueueContext";
import { AddOpponentBar } from "./AddOpponentBar";
import { AnimatedNumber } from "./AnimatedNumber";

type ChessPlatform = "lichess" | "chesscom";

type OpponentRow = {
  platform: ChessPlatform;
  username: string;
  created_at: string;
  last_refreshed_at: string | null;
  games_count?: number;
  style_markers?: Array<{
    marker_key: string;
    label: string;
    strength: string;
    tooltip: string;
  }>;
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

type ViewMode = "card" | "list";

type LichessUserStatus = {
  id: string;
  name: string;
  online: boolean;
  playing: boolean;
  ratings: Record<string, number>;
};

type LichessActivity = {
  username: string;
  gamesLast7Days: number;
  activityLevel: "inactive" | "active" | "very_active";
};

export function DashboardPage({ initialOpponents }: Props) {
  const MIN_GAMES_FOR_ANALYSIS = 10;
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [opponents, setOpponents] = useState<OpponentRow[]>(initialOpponents);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // View toggle state
  const [viewMode, setViewMode] = useState<ViewMode>("card");

  // Rich data layer - online status and ratings
  const [lichessStatus, setLichessStatus] = useState<Map<string, LichessUserStatus>>(new Map());
  const [lichessStatusLoading, setLichessStatusLoading] = useState(false);

  // Rich data layer - activity/busy-ness
  const [lichessActivity, setLichessActivity] = useState<Map<string, LichessActivity>>(new Map());
  const activityFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setIsMounted(true);
  }, []);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [displayIndexedCount, setDisplayIndexedCount] = useState(0);
  const [indeterminateArmed, setIndeterminateArmed] = useState(false);

  const { addToQueue, removeFromQueue, startImport, stopSync, isImporting, progress, currentOpponent, progressByOpponent, queue } = useImportQueue();

  const { imports } = useImportsRealtime();

  const [savedLinesOpen, setSavedLinesOpen] = useState<Record<string, boolean>>({});
  const [savedLinesByOpponent, setSavedLinesByOpponent] = useState<Record<string, SavedLineRow[]>>({});
  const [savedLinesBusy, setSavedLinesBusy] = useState<Record<string, boolean>>({});
  const [savedLinesError, setSavedLinesError] = useState<Record<string, string | null>>({});

  const [platform, setPlatform] = useState<ChessPlatform>("lichess");
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    function onDocClick() {
      setOpenMenuKey(null);
      setUserMenuOpen(false);
    }

    window.addEventListener("click", onDocClick);
    return () => window.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setUserEmail(data?.user?.email ?? null);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Fetch Lichess online status and ratings on page load
  const fetchLichessStatus = useCallback(async () => {
    const lichessUsers = opponents.filter((o) => o.platform === "lichess").map((o) => o.username);
    if (lichessUsers.length === 0) return;

    setLichessStatusLoading(true);
    try {
      const res = await fetch(`/api/lichess/status?usernames=${encodeURIComponent(lichessUsers.join(","))}`);
      if (!res.ok) return;
      const json = await res.json();
      const users = Array.isArray(json?.users) ? (json.users as LichessUserStatus[]) : [];
      const map = new Map<string, LichessUserStatus>();
      for (const u of users) {
        map.set(u.id.toLowerCase(), u);
      }
      setLichessStatus(map);
    } catch {
      // Ignore errors - this is non-blocking enrichment
    } finally {
      setLichessStatusLoading(false);
    }
  }, [opponents]);

  useEffect(() => {
    if (!isMounted) return;
    void fetchLichessStatus();
  }, [isMounted, fetchLichessStatus]);

  // Fetch activity for a single user (lazy, on-demand)
  const fetchActivity = useCallback(async (username: string) => {
    const key = username.toLowerCase();
    if (activityFetchedRef.current.has(key)) return;
    activityFetchedRef.current.add(key);

    try {
      const res = await fetch(`/api/lichess/activity?username=${encodeURIComponent(username)}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json?.username) {
        setLichessActivity((prev) => {
          const next = new Map(prev);
          next.set(key, json as LichessActivity);
          return next;
        });
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Fetch activity for all Lichess opponents on mount (non-blocking)
  useEffect(() => {
    if (!isMounted) return;
    const lichessUsers = opponents.filter((o) => o.platform === "lichess").map((o) => o.username);
    for (const u of lichessUsers) {
      void fetchActivity(u);
    }
  }, [isMounted, opponents, fetchActivity]);

  async function reloadOpponents() {
    const res = await fetch("/api/opponents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? "Failed to load opponents");
    setOpponents(Array.isArray(json?.opponents) ? (json.opponents as OpponentRow[]) : []);
  }

  // Keep DB-backed counts fresh while importing, and ensure we refresh once the import stops/finishes.
  const prevIsImportingRef = useRef(false);
  const lastReloadAtRef = useRef(0);
  useEffect(() => {
    const wasImporting = prevIsImportingRef.current;
    prevIsImportingRef.current = isImporting;

    if (wasImporting && !isImporting) {
      void reloadOpponents().catch(() => null);
    }
  }, [isImporting]);

  useEffect(() => {
    if (!isMounted) return;
    if (!isImporting) return;
    // Throttle reloads while importing.
    const now = Date.now();
    if (now - lastReloadAtRef.current < 2500) return;
    lastReloadAtRef.current = now;
    void reloadOpponents().catch(() => null);
  }, [currentOpponent, isImporting, isMounted, progress]);

  async function addOpponentWithValues(plat: ChessPlatform, user: string) {
    setLoading(true);
    setStatus(null);
    try {
      const trimmed = user.trim();
      if (!trimmed) throw new Error("Username is required");
      const usePlatform = plat;

      const res = await fetch("/api/opponents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: usePlatform, username: trimmed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to add opponent");

      const optimistic: OpponentRow = {
        platform: usePlatform,
        username: trimmed,
        created_at: new Date().toISOString(),
        last_refreshed_at: null,
        games_count: 0,
        style_markers: [],
      };

      setOpponents((prev) => {
        const key = `${usePlatform}:${trimmed.toLowerCase()}`;
        const next = prev.filter((p) => `${p.platform}:${p.username.toLowerCase()}` !== key);
        return [optimistic, ...next];
      });

      if (optimistic.platform !== "lichess") {
        setStatus("Fast import currently supports Lichess only");
      } else {
        const key = `${optimistic.platform}:${optimistic.username.toLowerCase()}`;
        addToQueue(key);
        startImport();
      }
      void reloadOpponents();
      setUsername("");
      setStatus(null);
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

  async function archiveOpponent(o: OpponentRow) {
    if (loading) return;
    if (activeImport && activeImport.platform === o.platform && activeImport.username.toLowerCase() === o.username.toLowerCase()) {
      setStatus("Stop the active import before archiving this opponent.");
      return;
    }

    const ok = window.confirm(
      `Archive ${o.platform === "lichess" ? "Lichess" : "Chess.com"} opponent '${o.username}'?\n\nYou can add them back later.`
    );
    if (!ok) return;

    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/opponents`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: o.platform, username: o.username, archived: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to archive opponent");
      await reloadOpponents();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to archive opponent");
    } finally {
      setLoading(false);
    }
  }

  function badgeClass(strength: string) {
    const v = String(strength ?? "").toLowerCase();
    if (v === "strong") return "border-amber-200 bg-amber-50 text-amber-800";
    if (v === "medium") return "border-blue-200 bg-blue-50 text-blue-800";
    return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }

  function truncateEmail(e: string) {
    const v = String(e ?? "");
    if (!v) return "";
    if (v.length <= 22) return v;
    const at = v.indexOf("@");
    if (at > 0) {
      const head = v.slice(0, Math.min(10, at));
      const tail = v.slice(at);
      return `${head}…${tail}`;
    }
    return `${v.slice(0, 12)}…${v.slice(-6)}`;
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
    router.push("/play?mode=analysis");
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

  async function handleAddOpponent(plat: ChessPlatform, user: string) {
    await addOpponentWithValues(plat, user);
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6">
        {/* Add Opponent Bar */}
        <AddOpponentBar onAdd={handleAddOpponent} loading={loading} />

        {/* View Toggle */}
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-zinc-700">
            {opponents.length} opponent{opponents.length !== 1 ? "s" : ""}
          </div>
          <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                viewMode === "card" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
              }`}
              title="Card view"
              onClick={() => setViewMode("card")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                viewMode === "list" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-50"
              }`}
              title="List view"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        {status ? <div className="text-sm text-neutral-600">{status}</div> : null}

        <section>

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

          {opponents.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-sm text-zinc-600">
              No opponents yet.
            </div>
          ) : viewMode === "list" ? (
            /* List View */
            <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50">
                  <tr>
                    <th className="px-4 py-3 font-medium text-zinc-700">Status</th>
                    <th className="px-4 py-3 font-medium text-zinc-700">Username</th>
                    <th className="px-4 py-3 font-medium text-zinc-700">Rating</th>
                    <th className="px-4 py-3 font-medium text-zinc-700">Style</th>
                    <th className="px-4 py-3 font-medium text-zinc-700">Synced</th>
                    <th className="px-4 py-3 font-medium text-zinc-700">Activity</th>
                    <th className="px-4 py-3 font-medium text-zinc-700"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {opponents.map((o) => {
                    const key = `${o.platform}:${o.username.toLowerCase()}`;
                    const latest = byKey.get(key) ?? o;
                    const dbGamesCount = typeof (latest as any)?.games_count === "number" ? (latest as any).games_count : 0;
                    const apiTotal = typeof (latest as any)?.total_games === "number" ? Math.max(0, Number((latest as any).total_games)) : 0;
                    const canUseScout = dbGamesCount >= MIN_GAMES_FOR_ANALYSIS;
                    const currentKey = latest.platform === "lichess" ? `lichess:${latest.username.toLowerCase()}` : null;
                    const isGlobalCurrent = Boolean(isImporting && currentKey && currentOpponent === currentKey);
                    const isFastRunning = isGlobalCurrent;
                    const isFastQueued = currentKey ? queue.includes(currentKey) && !isGlobalCurrent : false;
                    const markerBadges = Array.isArray((latest as any)?.style_markers) ? (((latest as any).style_markers as any[]) ?? []) : [];

                    // Rich data
                    const userStatus = latest.platform === "lichess" ? lichessStatus.get(latest.username.toLowerCase()) : null;
                    const userActivity = latest.platform === "lichess" ? lichessActivity.get(latest.username.toLowerCase()) : null;
                    const isOnline = userStatus?.online ?? false;
                    const blitzRating = userStatus?.ratings?.blitz;
                    const rapidRating = userStatus?.ratings?.rapid;
                    const bulletRating = userStatus?.ratings?.bullet;
                    const displayRating = blitzRating ?? rapidRating ?? bulletRating ?? null;

                    const activityText = userActivity
                      ? userActivity.activityLevel === "very_active"
                        ? "Very Active"
                        : userActivity.activityLevel === "active"
                          ? "Active"
                          : "Inactive"
                      : "—";

                    const syncPct = apiTotal > 0 ? Math.min(100, Math.round((dbGamesCount / apiTotal) * 100)) : 0;

                    return (
                      <tr key={key} className="hover:bg-zinc-50">
                        {/* Online Status */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${isOnline ? "bg-[#4CAF50]" : "bg-[#9E9E9E]"}`}
                            title={isOnline ? "Online" : "Offline"}
                          />
                        </td>
                        {/* Username */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900">{latest.username}</span>
                            {latest.platform === "lichess" ? (
                              <span className="text-[10px] text-zinc-400">lichess</span>
                            ) : (
                              <span className="text-[10px] text-zinc-400">chess.com</span>
                            )}
                          </div>
                        </td>
                        {/* Rating */}
                        <td className="px-4 py-3 tabular-nums text-zinc-700">
                          {displayRating ? displayRating : "—"}
                        </td>
                        {/* Style Badge */}
                        <td className="px-4 py-3">
                          {markerBadges.length > 0 ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeClass(String(markerBadges[0]?.strength ?? ""))}`}
                              title={String(markerBadges[0]?.tooltip ?? "") || undefined}
                            >
                              {String(markerBadges[0]?.label ?? "")}
                            </span>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        {/* Sync Progress */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-200">
                              <div
                                className={`h-full ${isFastRunning ? "bg-blue-500" : syncPct >= 100 ? "bg-green-500" : "bg-zinc-400"}`}
                                style={{ width: `${syncPct}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-zinc-600">
                              {dbGamesCount.toLocaleString()}
                              {apiTotal > 0 ? `/${apiTotal.toLocaleString()}` : ""}
                            </span>
                            {isFastRunning ? (
                              <RefreshCw className="h-3 w-3 animate-spin text-blue-500" />
                            ) : null}
                          </div>
                        </td>
                        {/* Activity */}
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs ${
                              userActivity?.activityLevel === "very_active"
                                ? "font-medium text-amber-600"
                                : userActivity?.activityLevel === "active"
                                  ? "text-zinc-700"
                                  : "text-zinc-400"
                            }`}
                          >
                            {activityText}
                          </span>
                        </td>
                        {/* Analyze Button */}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center justify-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                            disabled={!canUseScout && !isFastRunning}
                            onClick={() => prepare(latest)}
                          >
                            Analyze
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Card View */
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
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
              // games_count from server = actual games in DB (source of truth)
              const dbGamesCount = typeof (latest as any)?.games_count === "number" ? (latest as any).games_count : 0;
              const currentKey = latest.platform === "lichess" ? `lichess:${latest.username.toLowerCase()}` : null;
              const isGlobalCurrent = Boolean(isImporting && currentKey && currentOpponent === currentKey);
              // "Synced" must reflect what is actually persisted in DB (never the fast-import worker counter).
              const syncedGamesCount = dbGamesCount;
              const apiTotal = typeof (latest as any)?.total_games === "number" ? Math.max(0, Number((latest as any).total_games)) : 0;
              const canUseScout = dbGamesCount >= MIN_GAMES_FOR_ANALYSIS || isActive;

              const isFastRunning = isGlobalCurrent;
              const isFastQueued = currentKey ? queue.includes(currentKey) && !isGlobalCurrent : false;
              const markerBadges = Array.isArray((latest as any)?.style_markers) ? (((latest as any).style_markers as any[]) ?? []) : [];

              // Rich data for card view
              const userStatus = latest.platform === "lichess" ? lichessStatus.get(latest.username.toLowerCase()) : null;
              const userActivity = latest.platform === "lichess" ? lichessActivity.get(latest.username.toLowerCase()) : null;
              const isOnline = userStatus?.online ?? false;
              const blitzRating = userStatus?.ratings?.blitz;
              const rapidRating = userStatus?.ratings?.rapid;
              const bulletRating = userStatus?.ratings?.bullet;
              const displayRating = blitzRating ?? rapidRating ?? bulletRating ?? null;
              const activityLevel = userActivity?.activityLevel ?? null;

              const menuOpen = openMenuKey === key;
              const primaryLabel = canUseScout ? "Analyze" : "Prepare";
              const primaryEnabled = !loading && (primaryLabel === "Prepare" || canUseScout);

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
                <div key={key} className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-base font-semibold text-zinc-900">
                          {latest.username.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${isOnline ? "bg-[#4CAF50]" : "bg-[#9E9E9E]"}`}
                              title={isOnline ? "Online" : "Offline"}
                            />
                            <span className="truncate text-base font-semibold text-zinc-900">{latest.username}</span>
                            {displayRating ? (
                              <span className="shrink-0 text-xs tabular-nums text-zinc-500">{displayRating}</span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {markerBadges.length ? (
                              markerBadges.slice(0, 2).map((m: any) => (
                                <span
                                  key={String(m?.marker_key ?? m?.label ?? "")}
                                  title={String(m?.tooltip ?? "") || undefined}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badgeClass(String(m?.strength ?? ""))}`}
                                >
                                  {String(m?.label ?? "")}
                                </span>
                              ))
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                                No style markers yet
                              </span>
                            )}
                            {isFastRunning ? (
                              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                                Syncing…
                              </span>
                            ) : isFastQueued ? (
                              <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-700">
                                Queued
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {/* Synced Games Count - games usable for analysis */}
                      <div className="mt-3 flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-neutral-500">Synced:</span>
                          <AnimatedNumber value={syncedGamesCount} className="font-semibold text-neutral-900" />
                          {apiTotal > 0 ? (
                            <>
                              <span className="text-neutral-400">/</span>
                              <span className="text-neutral-500">{apiTotal.toLocaleString()}</span>
                            </>
                          ) : null}
                          <span className="text-neutral-500">games</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isFastRunning ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-medium text-blue-700">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Syncing
                            </span>
                          ) : isFastQueued ? (
                            <span className="inline-flex items-center rounded-full bg-neutral-200 px-2.5 py-1 text-[10px] font-medium text-neutral-600">
                              Queued
                            </span>
                          ) : syncedGamesCount > 0 && syncedGamesCount >= apiTotal && apiTotal > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-medium text-green-700">
                              <Check className="h-3 w-3" />
                              Complete
                            </span>
                          ) : syncedGamesCount > 0 ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-medium text-amber-700">
                              Partial
                            </span>
                          ) : null}
                          {/* Activity indicator */}
                          {activityLevel ? (
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${
                                activityLevel === "very_active"
                                  ? "bg-amber-100 text-amber-700"
                                  : activityLevel === "active"
                                    ? "bg-zinc-100 text-zinc-700"
                                    : "bg-zinc-50 text-zinc-400"
                              }`}
                            >
                              {activityLevel === "very_active" ? "Very Active" : activityLevel === "active" ? "Active" : "Inactive"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200 bg-white text-zinc-700 hover:bg-zinc-50"
                        title="Actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuKey((prev) => (prev === key ? null : key));
                        }}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>

                      {menuOpen ? (
                        <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
                          <button
                            type="button"
                            className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                            disabled={
                              loading ||
                              latest.platform !== "lichess" ||
                              (latest.platform === "lichess" && queue.includes(`lichess:${latest.username.toLowerCase()}`))
                            }
                            onClick={() => {
                              if (latest.platform !== "lichess") return;
                              addToQueue(`lichess:${latest.username.toLowerCase()}`);
                              startImport();
                              setOpenMenuKey(null);
                            }}
                            title={latest.platform !== "lichess" ? "Sync Games currently supports Lichess only" : "Sync Games (beta): streams from Lichess and writes aggregated opening graph"}
                          >
                            Sync Games
                          </button>

                          {isFastRunning ? (
                            <>
                              <div className="h-px bg-neutral-100" />
                              <button
                                type="button"
                                className="flex w-full items-center px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                disabled={loading}
                                onClick={() => {
                                  stopSync();
                                  setOpenMenuKey(null);
                                }}
                              >
                                Stop Sync
                              </button>
                            </>
                          ) : isFastQueued ? (
                            <>
                              <div className="h-px bg-neutral-100" />
                              <button
                                type="button"
                                className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                                disabled={loading}
                                onClick={() => {
                                  removeFromQueue(`lichess:${latest.username.toLowerCase()}`);
                                  setOpenMenuKey(null);
                                }}
                              >
                                Remove from Queue
                              </button>
                            </>
                          ) : null}

                          <div className="h-px bg-neutral-100" />
                          <button
                            type="button"
                            className="flex w-full items-center px-3 py-2 text-left text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                            disabled={loading || isActive}
                            onClick={() => void archiveOpponent(latest)}
                            title={isActive ? "Stop import before archiving" : undefined}
                          >
                            Archive
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                      disabled={!primaryEnabled}
                      title={primaryLabel === "Analyze" && !canUseScout ? `Waiting for ${MIN_GAMES_FOR_ANALYSIS} games to download...` : undefined}
                      onClick={() => prepare(latest)}
                    >
                      {primaryLabel}
                    </button>
                    <Link
                      href={`/opponents/${encodeURIComponent(latest.platform)}/${encodeURIComponent(latest.username)}/profile`}
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                    >
                      Profile
                    </Link>
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
          )}
        </section>
      </main>
    </div>
  );
}
