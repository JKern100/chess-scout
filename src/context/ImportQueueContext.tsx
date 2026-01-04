"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createOpeningGraphImporter } from "@/lib/openingGraphImport/openingGraphImportService";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type ImportQueueContextValue = {
  isImporting: boolean;
  progress: number;
  currentOpponent: string | null;
  progressByOpponent: Record<string, number>;
  queue: string[];
  addToQueue: (opponentId: string) => void;
  removeFromQueue: (opponentId: string) => void;
  startImport: () => void;
  stopSync: () => void;
};

const ImportQueueContext = createContext<ImportQueueContextValue | null>(null);

const PROGRESS_STORAGE_KEY = "chessscout.fastImport.progressByOpponent.v2";
const LAST_SYNC_STORAGE_KEY = "chessscout.fastImport.lastSyncTimestamp.v1";
const QUEUE_STORAGE_KEY = "chessscout.fastImport.queue.v1";

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
  const [isImporting, setIsImporting] = useState(false);
  const [currentOpponent, setCurrentOpponent] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);
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
  const finishingRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const importingRef = useRef(false);
  const currentOpponentRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const queuePersistTimerRef = useRef<number | null>(null);

  const progressByOpponentRef = useRef<Record<string, number>>({});
  const lastSyncTimestampRef = useRef<Record<string, number>>({});

  const lastSyncedPollAtRef = useRef(0);

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
    lastSyncTimestampRef.current = lastSyncTimestamp;
  }, [lastSyncTimestamp]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeUnload = () => {
      try {
        window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progressByOpponentRef.current));
        window.localStorage.setItem(LAST_SYNC_STORAGE_KEY, JSON.stringify(lastSyncTimestampRef.current));
        window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueRef.current));
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
  }, [lastSyncTimestamp, progressByOpponent]);

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

    const imp = importerRef.current;
    importerRef.current = null;
    if (imp) {
      void imp.stop().catch(() => null);
    }

    setIsImporting(false);
    setCurrentOpponent(null);
    setProgress(0);
    setQueue((prev) => prev.slice(1));

    finishingRef.current = false;
  }, []);

  const ensureImporter = useCallback(() => {
    if (importerRef.current) return importerRef.current;

    importerRef.current = createOpeningGraphImporter({
      onStatus: (s) => {
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
        if (s.phase === "done" || s.phase === "error") {
          finishCurrent();
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
    const nextKey = normalizeOpponentId(next);
    setCurrentOpponent(nextKey);
    
    // Set base count to previous synced count (for cumulative display)
    // Also get the last sync timestamp for incremental sync
    let sinceMs: number | undefined;
    setProgressByOpponent((prev) => {
      baseCountRef.current = Math.max(0, Number(prev[nextKey] ?? 0));
      return prev; // Don't modify, just read
    });
    setLastSyncTimestamp((prev) => {
      const ts = prev[nextKey];
      if (typeof ts === "number" && ts > 0) {
        // Add 1ms to avoid re-fetching the same game
        sinceMs = ts + 1;
      }
      return prev; // Don't modify, just read
    });
    setProgress(baseCountRef.current);
    setSyncedCount(baseCountRef.current);
    void pollSyncedCount(nextKey);

    const importer = ensureImporter();
    try {
      await importer.start({
        platform: "lichess",
        username: parsed.username,
        color: "both",
        rated: "any",
        sinceMs,
      });
    } catch {
      finishCurrent();
    }
  }, [ensureImporter, pollSyncedCount]);

  useEffect(() => {
    if (!isImporting || !currentOpponent) return;
    const id = window.setInterval(() => {
      void pollSyncedCount(currentOpponent);
    }, 2500);
    return () => window.clearInterval(id);
  }, [currentOpponent, isImporting, pollSyncedCount]);

  useEffect(() => {
    if (isImporting) return;
    if (queue.length === 0) return;
    void runNext();
  }, [isImporting, queue.length, runNext]);

  const addToQueue = useCallback((opponentId: string) => {
    const norm = normalizeOpponentId(opponentId);
    if (!norm) return;
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
      addToQueue,
      removeFromQueue,
      startImport,
      stopSync,
    }),
    [addToQueue, currentOpponent, isImporting, progress, progressByOpponent, queue, removeFromQueue, startImport, stopSync]
  );

  const pill = useMemo(() => {
    if (!isImporting || !currentOpponent) return null;
    const parsed = parseOpponentId(currentOpponent);
    const opponentLabel = parsed?.username ? parsed.username : currentOpponent;
    return (
      <div className="pointer-events-none fixed bottom-4 right-4 z-50">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          <span className="truncate">Syncing games…</span>
          <span className="tabular-nums text-zinc-600">({syncedCount} synced)</span>
          <span className="max-w-[140px] truncate text-zinc-500">{opponentLabel}</span>
          <button
            type="button"
            className="ml-1 inline-flex h-6 items-center justify-center rounded-full border border-zinc-200 bg-white px-2 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50"
            onClick={() => stopSync()}
          >
            Stop
          </button>
        </div>
      </div>
    );
  }, [currentOpponent, isImporting, stopSync, syncedCount]);

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
