"use client";

import { useState, useCallback, useEffect } from "react";
import type { SyntheticStylePreset } from "@/config/syntheticStylePresets";

export type SyntheticOpponentGame = {
  id: string;
  pgn: string;
  movesSan: string[];
  whitePlayer: string | null;
  blackPlayer: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  result: string | null;
  styleScore: number | null;
};

export type SyntheticOpponentData = {
  id: string;
  name: string;
  stylePreset: SyntheticStylePreset;
  openingFen: string;
  styleMarkers: any;
  games: SyntheticOpponentGame[];
  gamesCount: number;
};

/**
 * Hook for loading and using a synthetic opponent in simulation mode
 */
export function useSyntheticOpponent() {
  const [opponent, setOpponent] = useState<SyntheticOpponentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("chessscout.syntheticOpponent");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.id) {
          void loadOpponent(parsed.id);
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  const loadOpponent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/synthetic-opponents/${id}/games`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to load synthetic opponent");
      }

      setOpponent({
        id: json.opponent.id,
        name: json.opponent.name,
        stylePreset: json.opponent.stylePreset,
        openingFen: json.opponent.openingFen,
        styleMarkers: json.opponent.styleMarkers,
        games: json.games,
        gamesCount: json.gamesCount,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load opponent");
      setOpponent(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearOpponent = useCallback(() => {
    setOpponent(null);
    setError(null);
    try {
      window.localStorage.removeItem("chessscout.syntheticOpponent");
    } catch {
      // Ignore
    }
  }, []);

  /**
   * Get a move from the synthetic opponent's game corpus at a given position
   * Returns the most common move played from that position, weighted by style score
   */
  const getMoveAtPosition = useCallback((fen: string, moveHistory: string[]): string | null => {
    if (!opponent || opponent.games.length === 0) return null;

    // Find games that match the current position
    const plyIndex = moveHistory.length;
    const moveCounts = new Map<string, { count: number; totalScore: number }>();

    for (const game of opponent.games) {
      // Check if game matches our move history so far
      if (game.movesSan.length <= plyIndex) continue;

      let matches = true;
      for (let i = 0; i < plyIndex; i++) {
        if (game.movesSan[i] !== moveHistory[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        const nextMove = game.movesSan[plyIndex];
        const current = moveCounts.get(nextMove) || { count: 0, totalScore: 0 };
        current.count += 1;
        current.totalScore += game.styleScore || 1;
        moveCounts.set(nextMove, current);
      }
    }

    if (moveCounts.size === 0) return null;

    // Find the move with the highest weighted score
    let bestMove: string | null = null;
    let bestScore = -1;

    for (const [move, stats] of moveCounts.entries()) {
      // Weight by both frequency and style score
      const score = stats.count * (stats.totalScore / stats.count);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }, [opponent]);

  /**
   * Get move distribution at a position (for probability-weighted selection)
   */
  const getMoveDistribution = useCallback((fen: string, moveHistory: string[]): Array<{ move: string; probability: number; count: number }> => {
    if (!opponent || opponent.games.length === 0) return [];

    const plyIndex = moveHistory.length;
    const moveCounts = new Map<string, { count: number; totalScore: number }>();
    let totalCount = 0;

    for (const game of opponent.games) {
      if (game.movesSan.length <= plyIndex) continue;

      let matches = true;
      for (let i = 0; i < plyIndex; i++) {
        if (game.movesSan[i] !== moveHistory[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        const nextMove = game.movesSan[plyIndex];
        const current = moveCounts.get(nextMove) || { count: 0, totalScore: 0 };
        current.count += 1;
        current.totalScore += game.styleScore || 1;
        moveCounts.set(nextMove, current);
        totalCount += 1;
      }
    }

    if (totalCount === 0) return [];

    const distribution: Array<{ move: string; probability: number; count: number }> = [];
    for (const [move, stats] of moveCounts.entries()) {
      distribution.push({
        move,
        probability: stats.count / totalCount,
        count: stats.count,
      });
    }

    // Sort by probability descending
    distribution.sort((a, b) => b.probability - a.probability);
    return distribution;
  }, [opponent]);

  return {
    opponent,
    loading,
    error,
    loadOpponent,
    clearOpponent,
    getMoveAtPosition,
    getMoveDistribution,
  };
}
