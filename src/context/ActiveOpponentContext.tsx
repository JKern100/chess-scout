"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

type ChessPlatform = "lichess" | "chesscom";

type ActiveOpponent = {
  platform: ChessPlatform;
  username: string;
  rating?: number | null;
  isSelf?: boolean;
} | null;

type ActiveOpponentContextValue = {
  activeOpponent: ActiveOpponent;
  setActiveOpponent: (opponent: ActiveOpponent) => void;
  availableOpponents: Array<{ platform: ChessPlatform; username: string; rating?: number | null; isSelf?: boolean }>;
  setAvailableOpponents: (opponents: Array<{ platform: ChessPlatform; username: string; rating?: number | null; isSelf?: boolean }>) => void;
  refreshOpponents: () => Promise<void>;
  isLoading: boolean;
  selfPlayer: { platform: ChessPlatform; username: string } | null;
};

const ActiveOpponentContext = createContext<ActiveOpponentContextValue | null>(null);

const STORAGE_KEY = "chessscout.activeOpponent";

export function ActiveOpponentProvider({ children }: { children: React.ReactNode }) {
  const [activeOpponent, setActiveOpponentState] = useState<ActiveOpponent>(null);
  const [availableOpponents, setAvailableOpponents] = useState<Array<{ platform: ChessPlatform; username: string; rating?: number | null; isSelf?: boolean }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selfPlayer, setSelfPlayer] = useState<{ platform: ChessPlatform; username: string } | null>(null);

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
          isSelf: false,
        }))
        .filter((o) => o.username);

      // Add self player at the end if available
      const selfData = json?.selfPlayer;
      if (selfData?.username && selfData?.platform) {
        const selfEntry = {
          platform: (selfData.platform === "chesscom" ? "chesscom" : "lichess") as ChessPlatform,
          username: String(selfData.username).trim(),
          rating: null,
          isSelf: true,
        };
        // Only add if not already in list (avoid duplicate if user scouted themselves)
        const isDuplicate = out.some(
          (o) => o.platform === selfEntry.platform && o.username.toLowerCase() === selfEntry.username.toLowerCase()
        );
        if (!isDuplicate) {
          out.push(selfEntry);
        } else {
          // Mark the existing entry as self
          const existing = out.find(
            (o) => o.platform === selfEntry.platform && o.username.toLowerCase() === selfEntry.username.toLowerCase()
          );
          if (existing) existing.isSelf = true;
        }
        setSelfPlayer({ platform: selfEntry.platform, username: selfEntry.username });
      } else {
        setSelfPlayer(null);
      }

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
    selfPlayer,
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
