"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createOpeningGraphImporter } from "@/lib/openingGraphImport/openingGraphImportService";

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

const PROGRESS_STORAGE_KEY = "chessscout.fastImport.progressByOpponent.v1";

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
  const [queue, setQueue] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [currentOpponent, setCurrentOpponent] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
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

  const importerRef = useRef<ReturnType<typeof createOpeningGraphImporter> | null>(null);
  const finishingRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const importingRef = useRef(false);
  const currentOpponentRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

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
  }, [progressByOpponent]);

  const finishCurrent = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;

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
        const gp = Math.max(0, Number(s.gamesProcessed ?? 0));
        setProgress(gp);
        const key = currentOpponentRef.current;
        if (key) {
          setProgressByOpponent((prev) => {
            const before = Math.max(0, Number(prev[key] ?? 0));
            if (gp <= before) return prev;
            return { ...prev, [key]: gp };
          });
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
    setProgress(0);

    const importer = ensureImporter();
    try {
      await importer.start({
        platform: "lichess",
        username: parsed.username,
        color: "both",
        rated: "any",
      });
    } catch {
      finishCurrent();
    }
  }, [ensureImporter]);

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
          <span className="tabular-nums text-zinc-600">({progress} games processed)</span>
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
  }, [currentOpponent, isImporting, progress, stopSync]);

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
