"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createOpeningGraphImporter } from "@/lib/openingGraphImport/openingGraphImportService";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ImportPhase = "idle" | "streaming" | "saving" | "done" | "error";

type ImportQueueContextValue = {
  isImporting: boolean;
  progress: number;
  currentOpponent: string | null;
  progressByOpponent: Record<string, number>;
  queue: string[];
  importPhase: ImportPhase;
  pendingWrites: number;
  lastError: string | null;
  addToQueue: (opponentId: string, opts?: { maxGames?: number | null }) => void;
  removeFromQueue: (opponentId: string) => void;
  startImport: () => void;
  stopSync: () => void;
};

const ImportQueueContext = createContext<ImportQueueContextValue | null>(null);

const PROGRESS_STORAGE_KEY = "chessscout.fastImport.progressByOpponent.v2";
const LAST_SYNC_STORAGE_KEY = "chessscout.fastImport.lastSyncTimestamp.v1";
const QUEUE_STORAGE_KEY = "chessscout.fastImport.queue.v1";
const MAX_GAMES_BY_OPPONENT_STORAGE_KEY = "chessscout.fastImport.maxGamesByOpponent.v1";

function normalizeOpponentId(opponentId: string) {
  const raw = String(opponentId ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(":");
  if (parts.length === 1) {
    return `lichess:${parts[0].trim().toLowerCase()}`;
  }
  const platform = parts[0] === "chesscom" ? "chesscom" : "lichess";
  const username = parts.slice(1).join(":").trim().toLowerCase();
  if (!username) return "";
  return `${platform}:${username}`;
}

function parseOpponentId(opponentId: string): { platform: "lichess" | "chesscom"; username: string } | null {
  const norm = normalizeOpponentId(opponentId);
  if (!norm) return null;
  const [platformRaw, usernameRaw] = norm.split(":");
  const platform = platformRaw === "chesscom" ? "chesscom" : "lichess";
  const username = String(usernameRaw ?? "").trim().toLowerCase();
  if (!username) return null;
  return { platform, username };
}

export function ImportQueueProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<string[]>(() => {
    try {
      if (typeof window === "undefined") return [];
      const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const out: string[] = [];
      for (const item of parsed) {
        const norm = normalizeOpponentId(String(item ?? ""));
        if (!norm) continue;
        if (!out.includes(norm)) out.push(norm);
      }
      return out;
    } catch {
      return [];
    }
  });

  const [maxGamesByOpponent, setMaxGamesByOpponent] = useState<Record<string, number | null>>(() => {
    try {
      if (typeof window === "undefined") return {};
      const raw = window.localStorage.getItem(MAX_GAMES_BY_OPPONENT_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === null) {
          out[String(k)] = null;
          continue;
        }
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n > 0) out[String(k)] = n;
      }
      return out;
    } catch {
      return {};
    }
  });
  const [isImporting, setIsImporting] = useState(false);
  const [currentOpponent, setCurrentOpponent] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);
  const [importPhase, setImportPhase] = useState<ImportPhase>("idle");
  const [pendingWrites, setPendingWrites] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const [progressByOpponent, setProgressByOpponent] = useState<Record<string, number>>(() => {
    try {
      if (typeof window === "undefined") return {};
      const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n > 0) out[String(k)] = n;
      }
      return out;
    } catch {
      return {};
    }
  });

  // Track the newest game timestamp synced per opponent (for incremental sync)
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<Record<string, number>>(() => {
    try {
      if (typeof window === "undefined") return {};
      const raw = window.localStorage.getItem(LAST_SYNC_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n > 0) out[String(k)] = n;
      }
      return out;
    } catch {
      return {};
    }
  });

  // Track the base count (games synced before this session) for cumulative display
  const baseCountRef = useRef<number>(0);

  const importerRef = useRef<ReturnType<typeof createOpeningGraphImporter> | null>(null);
  const importPhaseRef = useRef<ImportPhase>("idle");
  const finishingRef = useRef(false);
  const importSessionRef = useRef(0); // Incremented each import to ignore stale updates
  const queueRef = useRef<string[]>([]);
  const importingRef = useRef(false);
  const currentOpponentRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const queuePersistTimerRef = useRef<number | null>(null);

  const progressByOpponentRef = useRef<Record<string, number>>({});
  const lastSyncTimestampRef = useRef<Record<string, number>>({});
  const maxGamesByOpponentRef = useRef<Record<string, number | null>>({});

  const lastSyncedPollAtRef = useRef(0);
  const lastActivityAtRef = useRef(0);
  const activityTimeoutRef = useRef<number | null>(null);

  // Activity timeout - if no progress for 5 minutes, consider import stalled
  const ACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes with no progress = stalled
  const MAX_GAMES_PER_IMPORT = 1000; // Cap imports at 1000 games for performance

  const pollSyncedCount = useCallback(async (opponentId: string) => {
    const parsed = parseOpponentId(opponentId);
    if (!parsed) return;
    const now = Date.now();
    if (now - lastSyncedPollAtRef.current < 2000) return;
    lastSyncedPollAtRef.current = now;

    const client = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user?.id) return;

    try {
      const usernameKey = parsed.username.toLowerCase();

      const { count: gamesCount, error: gamesErr } = await client
        .from("games")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", user.id)
        .eq("platform", parsed.platform)
        .ilike("username", usernameKey);

      const total = gamesErr ? 0 : typeof gamesCount === "number" ? gamesCount : 0;
      setSyncedCount(total);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    progressByOpponentRef.current = progressByOpponent;
  }, [progressByOpponent]);

  useEffect(() => {
    maxGamesByOpponentRef.current = maxGamesByOpponent;
  }, [maxGamesByOpponent]);

  useEffect(() => {
    lastSyncTimestampRef.current = lastSyncTimestamp;
  }, [lastSyncTimestamp]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeUnload = () => {
      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progressByOpponentRef.current));
        window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify(lastSyncTimestampRef.current));
        window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueRef.current));
        window.localStorage.setItem(MAX_GAMES_BY_OPPONENT_STORAGE_KEY, JSON.stringify(maxGamesByOpponentRef.current));
      } catch {
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    importingRef.current = isImporting;
  }, [isImporting]);

  useEffect(() => {
    currentOpponentRef.current = currentOpponent;
  }, [currentOpponent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (persistTimerRef.current != null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progressByOpponent));
        window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify(lastSyncTimestamp));
        window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueRef.current));
        window.localStorage.setItem(MAX_GAMES_BY_OPPONENT_STORAGE_KEY, JSON.stringify(maxGamesByOpponent));
      } catch {
        // ignore
      }
    }, 250);

    return () => {
      if (persistTimerRef.current != null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [lastSyncTimestamp, maxGamesByOpponent, progressByOpponent]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (queuePersistTimerRef.current != null) {
      window.clearTimeout(queuePersistTimerRef.current);
      queuePersistTimerRef.current = null;
    }

    queuePersistTimerRef.current = window.setTimeout(() => {
      queuePersistTimerRef.current = null;
      try {
        window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueRef.current));
      } catch {
        // ignore
      }
    }, 250);

    return () => {
      if (queuePersistTimerRef.current != null) {
        window.clearTimeout(queuePersistTimerRef.current);
        queuePersistTimerRef.current = null;
      }
    };
  }, [queue]);

  const finishCurrent = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;

    console.log("[ImportQueue] finishCurrent called, currentOpponent:", currentOpponentRef.current);

    importingRef.current = false;
    importPhaseRef.current = "idle";
    
    // Invalidate the current session to ignore any stale updates
    importSessionRef.current++;

    // IMPORTANT: Stop and destroy the importer completely
    const imp = importerRef.current;
    importerRef.current = null;
    if (imp) {
      // Stop the worker and wait for cleanup
      void imp.stop().catch(() => null);
    }

    setIsImporting(false);
    setCurrentOpponent(null);
    setProgress(0);
    setImportPhase("idle");
    setPendingWrites(0);
    setLastError(null); // Clear error on finish
    setQueue((prev) => prev.slice(1));

    finishingRef.current = false;
  }, []);

  const createNewImporter = useCallback(() => {
    // ALWAYS create a new importer - never reuse to avoid state mixing
    if (importerRef.current) {
      // Stop any existing importer first
      void importerRef.current.stop().catch(() => null);
      importerRef.current = null;
    }
    
    // Increment session ID to track this import
    importSessionRef.current++;
    const sessionId = importSessionRef.current;

    importerRef.current = createOpeningGraphImporter({
      onStatus: (s) => {
        // Ignore stale updates from previous sessions
        if (sessionId !== importSessionRef.current) {
          console.log("[ImportQueue] Ignoring stale update from session", sessionId, "current is", importSessionRef.current);
          return;
        }
        
        // Update activity timestamp on any status update
        lastActivityAtRef.current = Date.now();

        // Update phase tracking
        if (s.phase !== importPhaseRef.current) {
          importPhaseRef.current = s.phase;
          setImportPhase(s.phase);
        }
        setPendingWrites(s.pendingWrites ?? 0);
        
        // Capture error messages
        if (s.lastError) {
          setLastError(s.lastError);
        }

        // gp is games processed in THIS session
        const gp = Math.max(0, Number(s.gamesProcessed ?? 0));
        // Total = base (from previous syncs) + current session progress
        const total = baseCountRef.current + gp;
        setProgress(total);

        const key = currentOpponentRef.current;
        if (key) {
          void pollSyncedCount(key);
        }
        if (key) {
          setProgressByOpponent((prev) => {
            const before = Math.max(0, Number(prev[key] ?? 0));
            if (total <= before) return prev;
            return { ...prev, [key]: total };
          });
          // Track the newest game timestamp for incremental sync
          if (typeof s.newestGameTimestamp === "number" && s.newestGameTimestamp > 0) {
            setLastSyncTimestamp((prev) => {
              const before = prev[key] ?? 0;
              if (s.newestGameTimestamp! <= before) return prev;
              return { ...prev, [key]: s.newestGameTimestamp! };
            });
          }
        }
        if (s.phase === "done") {
          console.log("[ImportQueue] Import completed successfully, games:", s.gamesProcessed);
          try {
            const current = currentOpponentRef.current;
            const parsed = current ? parseOpponentId(current) : null;
            if (parsed?.platform === "lichess") {
              void fetch("/api/imports/lichess/opponent/start", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ platform: parsed.platform, username: parsed.username }),
              });
            }
          } catch {
          }
          // Show "Complete!" briefly before dismissing
          setTimeout(() => {
            finishCurrent();
          }, 2000);
        } else if (s.phase === "error") {
          console.log("[ImportQueue] Import failed with error:", s.lastError);
          // Show error briefly before dismissing
          setTimeout(() => {
            finishCurrent();
          }, 3000);
        }
      },
    });

    return importerRef.current;
  }, [finishCurrent]);

  const runNext = useCallback(async () => {
    if (importingRef.current) return;
    const next = queueRef.current[0];
    if (!next) return;

    const parsed = parseOpponentId(next);
    if (!parsed) {
      setQueue((prev) => prev.slice(1));
      return;
    }

    if (parsed.platform !== "lichess") {
      setQueue((prev) => prev.slice(1));
      return;
    }

    importingRef.current = true;
    setIsImporting(true);
    setLastError(null); // Clear any previous error
    const nextKey = normalizeOpponentId(next);
    setCurrentOpponent(nextKey);
    lastActivityAtRef.current = Date.now();
    console.log("[ImportQueue] Starting import for:", nextKey);

    try {
      const res = await fetch("/api/imports/lichess/opponent/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: parsed.platform, username: parsed.username }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as any));
        const msg = String((json as any)?.error ?? `Failed to start import (${res.status})`);
        setLastError(msg);
        finishCurrent();
        return;
      }
    } catch {
      setLastError("Failed to start import");
      finishCurrent();
      return;
    }

    // Ensure this opponent exists in the `opponents` table so it appears immediately
    // in the global opponent dropdown (which is backed by /api/opponents).
    try {
      const client = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (user?.id) {
        await client
          .from("opponents")
          .upsert(
            {
              user_id: user.id,
              platform: parsed.platform,
              username: parsed.username,
              last_refreshed_at: null,
              archived_at: null,
            },
            { onConflict: "user_id,platform,username" }
          );
      }
    } catch {
      // best-effort
    }
    
    // Query the ACTUAL database count - localStorage might be stale from failed syncs
    let actualDbCount = 0;
    try {
      const client = createSupabaseBrowserClient();
      const { data: { user } } = await client.auth.getUser();
      if (user?.id) {
        const { count } = await client
          .from("games")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", user.id)
          .eq("platform", parsed.platform)
          .ilike("username", parsed.username.toLowerCase());
        actualDbCount = typeof count === "number" ? count : 0;
      }
    } catch (e) {
      console.warn("[ImportQueue] Failed to query actual DB count:", e);
    }
    
    console.log("[ImportQueue] Actual DB count for", nextKey, ":", actualDbCount);
    baseCountRef.current = actualDbCount;
    
    // For incremental sync (refresh): use lastSyncTimestamp if we have games
    // For initial import: no sinceMs filter, just cap at MAX_GAMES_PER_IMPORT
    let sinceMs: number | undefined = undefined;
    
    const lastTs = lastSyncTimestampRef.current[nextKey];
    if (actualDbCount > 0 && typeof lastTs === "number" && lastTs > 0) {
      // Incremental sync: fetch games newer than last sync
      sinceMs = lastTs + 1;
      console.log("[ImportQueue] Using incremental sync from", new Date(sinceMs).toISOString());
    } else if (lastTs) {
      // Clear stale timestamp if no games are in the database
      console.log("[ImportQueue] Clearing stale lastSyncTimestamp for", nextKey, "(DB has 0 games)");
      delete lastSyncTimestampRef.current[nextKey];
      setLastSyncTimestamp((prev) => {
        const next = { ...prev };
        delete next[nextKey];
        return next;
      });
      // Also clear stale progress from localStorage
      delete progressByOpponentRef.current[nextKey];
      setProgressByOpponent((prev) => {
        const next = { ...prev };
        delete next[nextKey];
        return next;
      });
    }
    
    const maxGamesOverride = maxGamesByOpponentRef.current[nextKey];
    const effectiveMaxGames = typeof maxGamesOverride === "number" && maxGamesOverride > 0 ? maxGamesOverride : MAX_GAMES_PER_IMPORT;
    console.log(
      "[ImportQueue] Import for",
      nextKey,
      "- sinceMs:",
      sinceMs ? new Date(sinceMs).toISOString() : "(initial)",
      "maxGames:",
      effectiveMaxGames
    );
    
    setProgress(actualDbCount);
    setSyncedCount(actualDbCount);

    const importer = createNewImporter();
    try {
      await importer.start({
        platform: "lichess",
        username: parsed.username,
        color: "both",
        rated: "any",
        sinceMs,
        maxGames: effectiveMaxGames,
      });
    } catch {
      finishCurrent();
    }
  }, [createNewImporter, pollSyncedCount, finishCurrent]);

  useEffect(() => {
    if (!isImporting || !currentOpponent) return;
    const id = window.setInterval(() => {
      void pollSyncedCount(currentOpponent);
    }, 2500);
    return () => window.clearInterval(id);
  }, [currentOpponent, isImporting, pollSyncedCount]);

  // Activity timeout monitor - detect stalled imports
  useEffect(() => {
    if (!isImporting) {
      if (activityTimeoutRef.current) {
        window.clearInterval(activityTimeoutRef.current);
        activityTimeoutRef.current = null;
      }
      return;
    }

    activityTimeoutRef.current = window.setInterval(() => {
      const now = Date.now();
      const lastActivity = lastActivityAtRef.current;
      const elapsed = now - lastActivity;

      if (elapsed > ACTIVITY_TIMEOUT_MS) {
        console.warn("[ImportQueue] Activity timeout - no progress for", Math.round(elapsed / 1000), "seconds. Finishing import.");
        finishCurrent();
      }
    }, 10000); // Check every 10 seconds

    return () => {
      if (activityTimeoutRef.current) {
        window.clearInterval(activityTimeoutRef.current);
        activityTimeoutRef.current = null;
      }
    };
  }, [isImporting, finishCurrent]);

  useEffect(() => {
    if (isImporting) return;
    if (queue.length === 0) return;
    void runNext();
  }, [isImporting, queue.length, runNext]);

  const addToQueue = useCallback((opponentId: string, opts?: { maxGames?: number | null }) => {
    const norm = normalizeOpponentId(opponentId);
    if (!norm) return;

    const requestedMaxGames = opts?.maxGames;
    if (requestedMaxGames === null || (typeof requestedMaxGames === "number" && requestedMaxGames > 0)) {
      setMaxGamesByOpponent((prev) => {
        const before = prev[norm];
        if (before === requestedMaxGames) return prev;
        return { ...prev, [norm]: requestedMaxGames as any };
      });
    }
    setQueue((prev) => {
      if (prev.includes(norm)) return prev;
      return [...prev, norm];
    });
  }, []);

  const removeFromQueue = useCallback((opponentId: string) => {
    const norm = normalizeOpponentId(opponentId);
    if (!norm) return;
    setQueue((prev) => prev.filter((k) => k !== norm));
  }, []);

  const stopSync = useCallback(() => {
    finishCurrent();
  }, [finishCurrent]);

  const startImport = useCallback(() => {
    if (importingRef.current) return;
    if (queueRef.current.length === 0) return;
    void runNext();
  }, [runNext]);

  const value = useMemo<ImportQueueContextValue>(
    () => ({
      isImporting,
      progress,
      currentOpponent,
      progressByOpponent,
      queue,
      importPhase,
      pendingWrites,
      lastError,
      addToQueue,
      removeFromQueue,
      startImport,
      stopSync,
    }),
    [addToQueue, currentOpponent, importPhase, isImporting, lastError, pendingWrites, progress, progressByOpponent, queue, removeFromQueue, startImport, stopSync]
  );

  const pill = useMemo(() => {
    if (!isImporting || !currentOpponent) return null;
    const parsed = parseOpponentId(currentOpponent);
    const opponentLabel = parsed?.username ? parsed.username : currentOpponent;
    
    // Determine status message and indicator color based on phase
    let statusMessage = "Syncing…";
    let indicatorColor = "bg-emerald-500";
    let statusDetail = `${syncedCount} synced`;
    
    if (importPhase === "streaming") {
      statusMessage = "Downloading…";
      indicatorColor = "bg-blue-500";
      statusDetail = `${syncedCount} games`;
    } else if (importPhase === "saving") {
      statusMessage = "Saving…";
      indicatorColor = "bg-amber-500";
      statusDetail = pendingWrites > 0 ? `${pendingWrites} pending` : `${syncedCount} saved`;
    } else if (importPhase === "done") {
      statusMessage = "Complete!";
      indicatorColor = "bg-emerald-500";
      statusDetail = `${syncedCount} synced`;
    } else if (importPhase === "error") {
      statusMessage = "Error";
      indicatorColor = "bg-red-500";
      statusDetail = lastError ? lastError.slice(0, 50) : "Failed";
    }
    
    return (
      <div className="pointer-events-none fixed bottom-4 right-4 z-50">
        <div className="pointer-events-auto flex max-w-md flex-col gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 ${importPhase === "done" || importPhase === "error" ? "" : "animate-pulse"} rounded-full ${indicatorColor}`} />
            <span className="truncate">{statusMessage}</span>
            {importPhase !== "error" && (
              <span className="tabular-nums text-zinc-600">({statusDetail})</span>
            )}
            <span className="max-w-[140px] truncate text-zinc-500">{opponentLabel}</span>
            <button
              type="button"
              className="ml-1 inline-flex h-6 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-2 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50"
              onClick={() => stopSync()}
            >
              {importPhase === "error" ? "Dismiss" : "Stop"}
            </button>
          </div>
          {importPhase === "error" && lastError && (
            <div className="text-[10px] font-normal text-red-600 line-clamp-2">
              {lastError}
            </div>
          )}
        </div>
      </div>
    );
  }, [currentOpponent, importPhase, isImporting, lastError, pendingWrites, stopSync, syncedCount]);

  return (
    <ImportQueueContext.Provider value={value}>
      {children}
      {pill}
    </ImportQueueContext.Provider>
  );
}

export function useImportQueue() {
  const ctx = useContext(ImportQueueContext);
  if (!ctx) {
    throw new Error("useImportQueue must be used within ImportQueueProvider");
  }
  return ctx;
}
