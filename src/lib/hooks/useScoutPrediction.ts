"use client";

import { useCallback, useRef, useState } from "react";
import type {
  PredictionMode,
  ScoutPrediction,
  StyleMarkers,
} from "@/components/chess/ScoutOverlay";

type HistoryMove = {
  move_san: string;
  frequency: number;
  last_played?: string;
  avg_result?: number;
};

type PredictParams = {
  fen: string;
  opponentUsername: string;
  styleMarkers?: StyleMarkers;
  historyMoves?: HistoryMove[];
  recentEvalDeltas?: number[];
  moveNumber?: number;
};

const DEFAULT_STYLE_MARKERS: StyleMarkers = {
  aggression_index: 50,
  queen_trade_avoidance: 50,
  material_greed: 50,
  complexity_preference: 50,
  space_expansion: 50,
  blunder_rate: 5,
  time_pressure_weakness: 50,
};

// Use Next.js API proxy to avoid CORS issues
const SCOUT_API_URL = "/api/scout";

export function useScoutPrediction() {
  const [prediction, setPrediction] = useState<ScoutPrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PredictionMode>("hybrid");
  
  const abortRef = useRef<AbortController | null>(null);

  const predictOnce = useCallback(
    async (params: PredictParams): Promise<ScoutPrediction> => {
      const body = {
        fen: params.fen,
        mode,
        opponent_username: params.opponentUsername,
        style_markers: params.styleMarkers || DEFAULT_STYLE_MARKERS,
        history_moves: params.historyMoves || [],
        recent_eval_deltas: params.recentEvalDeltas || [],
        move_number: params.moveNumber || 1,
      };

      const res = await fetch(`${SCOUT_API_URL}/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errorMessage = errData.error || errData.detail || `Scout API error: ${res.status}`;
        
        // If Scout API is not configured, show a more user-friendly message
        if (res.status === 503) {
          throw new Error("Scout Insights not available on this server");
        }
        
        throw new Error(errorMessage);
      }

      const data = await res.json();
      return data as ScoutPrediction;
    },
    [mode]
  );

  const predict = useCallback(
    async (params: PredictParams): Promise<ScoutPrediction | null> => {
      // Cancel any pending request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const body = {
          fen: params.fen,
          mode,
          opponent_username: params.opponentUsername,
          style_markers: params.styleMarkers || DEFAULT_STYLE_MARKERS,
          history_moves: params.historyMoves || [],
          recent_eval_deltas: params.recentEvalDeltas || [],
          move_number: params.moveNumber || 1,
        };

        const res = await fetch(`${SCOUT_API_URL}/predict`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const errorMessage = errData.error || errData.detail || `Scout API error: ${res.status}`;
          
          // If Scout API is not configured, show a more user-friendly message
          if (res.status === 503) {
            throw new Error("Scout Insights not available on this server");
          }
          
          throw new Error(errorMessage);
        }

        const data = await res.json();
        setPrediction(data as ScoutPrediction);
        return data as ScoutPrediction;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return null;
        }
        const message = err instanceof Error ? err.message : "Prediction failed";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [mode]
  );

  const clearPrediction = useCallback(() => {
    setPrediction(null);
    setError(null);
  }, []);

  return {
    prediction,
    loading,
    error,
    mode,
    setMode,
    predict,
    predictOnce,
    clearPrediction,
  };
}
