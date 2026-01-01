"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type ChessPlatform = "lichess" | "chesscom";

type ActiveOpponent = {
  platform: ChessPlatform;
  username: string;
  rating?: number | null;
} | null;

type ActiveOpponentContextValue = {
  activeOpponent: ActiveOpponent;
  setActiveOpponent: (opponent: ActiveOpponent) => void;
  availableOpponents: Array<{ platform: ChessPlatform; username: string; rating?: number | null }>;
  setAvailableOpponents: (opponents: Array<{ platform: ChessPlatform; username: string; rating?: number | null }>) => void;
  refreshOpponents: () => Promise<void>;
  isLoading: boolean;
};

const ActiveOpponentContext = createContext<ActiveOpponentContextValue | null>(null);

const STORAGE_KEY = "chessscout.activeOpponent";

export function ActiveOpponentProvider({ children }: { children: React.ReactNode }) {
  const [activeOpponent, setActiveOpponentState] = useState<ActiveOpponent>(null);
  const [availableOpponents, setAvailableOpponents] = useState<Array<{ platform: ChessPlatform; username: string; rating?: number | null }>>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.platform && parsed?.username) {
          setActiveOpponentState({
            platform: parsed.platform === "chesscom" ? "chesscom" : "lichess",
            username: String(parsed.username),
            rating: typeof parsed.rating === "number" ? parsed.rating : null,
          });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch available opponents on mount
  useEffect(() => {
    void refreshOpponents();
  }, []);

  const setActiveOpponent = useCallback((opponent: ActiveOpponent) => {
    setActiveOpponentState(opponent);
    try {
      if (opponent) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opponent));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshOpponents = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/opponents", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      const rows = Array.isArray(json?.opponents) ? (json.opponents as any[]) : [];
      const out = rows
        .map((o) => ({
          platform: (o?.platform === "chesscom" ? "chesscom" : "lichess") as ChessPlatform,
          username: String(o?.username ?? "").trim(),
          rating: typeof o?.rating === "number" ? o.rating : null,
        }))
        .filter((o) => o.username);
      setAvailableOpponents(out);

      // If no active opponent set but we have opponents, set the first one
      if (!activeOpponent && out.length > 0) {
        setActiveOpponent(out[0]);
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, [activeOpponent, setActiveOpponent]);

  const value: ActiveOpponentContextValue = {
    activeOpponent,
    setActiveOpponent,
    availableOpponents,
    setAvailableOpponents,
    refreshOpponents,
    isLoading,
  };

  return (
    <ActiveOpponentContext.Provider value={value}>
      {children}
    </ActiveOpponentContext.Provider>
  );
}

export function useActiveOpponent() {
  const ctx = useContext(ActiveOpponentContext);
  if (!ctx) {
    throw new Error("useActiveOpponent must be used within ActiveOpponentProvider");
  }
  return ctx;
}
