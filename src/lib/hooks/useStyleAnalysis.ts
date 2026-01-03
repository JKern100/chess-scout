"use client";

import { useCallback, useRef, useState } from "react";
import type { StyleMarkers } from "@/components/chess/ScoutOverlay";

type StyleAnalysisResult = {
  move_uci: string;
  engine_eval: number;
  style_fit: number;
  style_adjustment: number;
  adjusted_eval: number;
  badges: Array<{
    type: string;
    value: string;
    color: string;
  }>;
  attribution: any;
};

type AnalyzeParams = {
  fen: string;
  moves: string[];
  opponentUsername?: string;
  styleMarkers?: StyleMarkers;
};

// Use Next.js API proxy to avoid CORS issues
const SCOUT_API_URL = "/api/scout";

export function useStyleAnalysis() {
  const [analysis, setAnalysis] = useState<StyleAnalysisResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const abortRef = useRef<AbortController | null>(null);

  const analyze = useCallback(
    async (params: AnalyzeParams): Promise<StyleAnalysisResult[] | null> => {
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
          moves: params.moves,
          opponent_username: params.opponentUsername || "unknown",
          style_markers: params.styleMarkers || {
            aggression_index: 50,
            queen_trade_avoidance: 50,
            material_greed: 50,
            complexity_preference: 50,
            space_expansion: 50,
            blunder_rate: 5,
            time_pressure_weakness: 50,
          },
        };

        const res = await fetch(`${SCOUT_API_URL}/analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || `Scout API error: ${res.status}`);
        }

        const data = await res.json();
        setAnalysis(data.moves);
        return data.moves;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return null;
        }
        const message = err instanceof Error ? err.message : "Style analysis failed";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const clearAnalysis = useCallback(() => {
    setAnalysis(null);
    setError(null);
  }, []);

  return {
    analysis,
    loading,
    error,
    analyze,
    clearAnalysis,
  };
}
