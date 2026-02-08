"use client";

import { Chess } from "chess.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChessBoardCoreState } from "./ChessBoardCore";
import { evaluateBestMove, evaluatePositionShallow, type EngineScore } from "@/lib/engine/engineService";
import { sanToFigurine } from "@/components/chess/FigurineIcon";
import { useStyleAnalysis } from "@/lib/hooks/useStyleAnalysis";
import { useDateFilterRefinement } from "@/lib/hooks/useDateFilterRefinement";
import { normalizeFen } from "@/server/opponentModel";
import { Zap, AlertTriangle, TrendingUp, Target, Braces, X, Loader2 } from "lucide-react";

type Strategy = "proportional" | "random";

type Props = {
  state: ChessBoardCoreState;
  opponentUsername: string;
  opponentImportedCount: number;
  isSyncing: boolean;
  filtersKey: string;
  requestOpponentMove: (params: { fen: string; username: string; mode: Strategy; prefetch?: boolean; force_rpc?: boolean }) => Promise<any>;
  showArrow: boolean;
  onShowArrowChange: (v: boolean) => void;
  showEval: boolean;
  onEvalChange: (score: EngineScore | null) => void;
  showEngineBest: boolean;
  engineBestMove: { uci: string; san: string | null } | null;
  setEngineBestMove: (m: { uci: string; san: string | null } | null) => void;
  showEngineColumn: boolean;
  enabled: boolean;
  opponentStatsBusy: boolean;
  opponentStats: {
    totalCountOpponent: number;
    totalCountAgainst: number;
    depthRemaining: number | null;
    movesOpponent: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
    movesAgainst: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
  } | null;
  setOpponentStats: (s: Props["opponentStats"]) => void;
  setOpponentStatsBusy: (v: boolean) => void;
  // Style analysis props
  styleMarkers?: {
    aggression_index: number;
    queen_trade_avoidance: number;
    material_greed: number;
    complexity_preference: number;
    space_expansion: number;
    blunder_rate: number;
    time_pressure_weakness: number;
  };
  // Date filter refinement props (Phase 1b)
  platform?: string;
  filterFrom?: string | null;
  filterTo?: string | null;
  filterSpeeds?: string[] | null;
  filterRated?: 'any' | 'rated' | 'casual';
  filterOpponentColor?: 'w' | 'b' | null; // Filter by which color opponent played
  filterOpeningEco?: string | null;  // Filter by ECO code (e.g., "A10")
  filterOpeningName?: string | null; // Filter by opening name
  engineDepth?: number;
  isSyntheticMode?: boolean;
  syntheticGamesCount?: number;
};

type MoveRow = {
  uci: string;
  san: string | null;
  played_count: number;
  win: number;
  loss: number;
  draw: number;
};

type CandidateMoveRowProps = {
  uci: string;
  san: string | null;
  playedCount: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
  freqPct: number;
  isEngine: boolean;
  showEngineColumn: boolean;
  evalLabel: string | null;
  adjustedEvalLabel?: string | null;
  styleBadges?: Array<{
    type: string;
    value: string;
    color: string;
  }>;
  onPlay: (uci: string) => void;
  formatGameCount: (n: number) => string;
  isWhiteMove: boolean;
};

const CandidateMoveRow = memo(function CandidateMoveRow(props: CandidateMoveRowProps) {
  const {
    uci,
    san,
    playedCount,
    winPct,
    drawPct,
    lossPct,
    freqPct,
    isEngine,
    showEngineColumn,
    evalLabel,
    adjustedEvalLabel,
    styleBadges,
    onPlay,
    formatGameCount,
    isWhiteMove,
  } = props;

  // Helper to render style badges
  const renderStyleBadge = (badge: { type: string; value: string; color: string }) => {
    const iconMap = {
      aggression: Zap,
      trade: AlertTriangle,
      greed: TrendingUp,
      complexity: Target,
      space: Braces,
    };
    
    const Icon = iconMap[badge.type as keyof typeof iconMap] || Zap;
    const colorMap = {
      red: "text-red-600 bg-red-100",
      orange: "text-orange-600 bg-orange-100",
      yellow: "text-yellow-600 bg-yellow-100",
      purple: "text-purple-600 bg-purple-100",
      blue: "text-blue-600 bg-blue-100",
    };
    
    return (
      <span
        key={badge.type}
        className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium ${colorMap[badge.color as keyof typeof colorMap] || "text-zinc-600 bg-zinc-100"}`}
        title={`${badge.type}: ${badge.value}`}
      >
        <Icon className="h-2.5 w-2.5" />
        {badge.value}
      </span>
    );
  };

  return (
    <button
      type="button"
      className={`grid ${
        showEngineColumn ? "grid-cols-[56px_48px_48px_1fr_36px]" : "grid-cols-[56px_48px_1fr_36px]"
      } items-center gap-1 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-50 ${isEngine ? "ring-1 ring-emerald-200" : ""}`}
      onClick={() => onPlay(uci)}
    >
      <div className="flex min-w-0 items-center gap-1 font-medium text-zinc-900">
        <span className="min-w-0 truncate">{san ? sanToFigurine(san, isWhiteMove) : uci}</span>
        {isEngine ? (
          <span className="rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">E</span>
        ) : null}
      </div>
      <div className="font-medium text-zinc-700">{formatGameCount(playedCount)}</div>
      {showEngineColumn ? (
        <div className="flex flex-col gap-0.5">
          <div className="min-w-0 truncate font-medium text-zinc-500">{evalLabel}</div>
          {adjustedEvalLabel && adjustedEvalLabel !== evalLabel ? (
            <div className="min-w-0 truncate font-medium text-amber-600">{adjustedEvalLabel}</div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <div className="h-2.5 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
          <div className="flex h-full w-full">
            <div className="h-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${winPct}%` }} />
            <div className="h-full bg-zinc-300 transition-[width] duration-200" style={{ width: `${drawPct}%` }} />
            <div className="h-full bg-rose-500 transition-[width] duration-200" style={{ width: `${lossPct}%` }} />
          </div>
        </div>
        {styleBadges && styleBadges.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {styleBadges.slice(0, 2).map(renderStyleBadge)}
          </div>
        )}
      </div>
      <div className="text-right font-medium text-zinc-700">{freqPct}%</div>
    </button>
  );
});

export function AnalysisBoard(props: Props) {
  const {
    state,
    opponentUsername,
    opponentImportedCount,
    isSyncing,
    filtersKey,
    requestOpponentMove,
    showArrow,
    onShowArrowChange,
    showEval,
    onEvalChange,
    showEngineBest,
    engineBestMove,
    setEngineBestMove,
    showEngineColumn,
    enabled,
    opponentStats,
    setOpponentStats,
    opponentStatsBusy,
    setOpponentStatsBusy,
    styleMarkers,
    // Date filter refinement props
    platform = 'lichess',
    filterFrom,
    filterTo,
    filterSpeeds,
    filterRated = 'any',
    filterOpponentColor,
    filterOpeningEco,
    filterOpeningName,
    engineDepth = 18,
    isSyntheticMode = false,
    syntheticGamesCount,
  } = props;
  
  // Compute position key for refinement
  const positionKey = useMemo(() => normalizeFen(state.fen), [state.fen]);
  
  // Compute which side's moves to show based on whose turn it is
  const currentTurn = state.game.turn();
  const playerColor = state.playerSide === "white" ? "w" : "b";
  const refinementSide = currentTurn !== playerColor ? 'opponent' : 'against';
  
  // Date filter refinement hook
  const {
    state: refinementState,
    cancelRefinement,
    isRefining,
    hasRefinedData,
  } = useDateFilterRefinement({
    platform,
    opponent: opponentUsername,
    positionKey,
    side: refinementSide,
    from: filterFrom ?? null,
    to: filterTo ?? null,
    speeds: filterSpeeds ?? null,
    rated: filterRated,
    opponentColor: filterOpponentColor,
    openingEco: filterOpeningEco,
    openingName: filterOpeningName,
    enabled,
  });

  const engineReqIdRef = useRef(0);
  const evalReqIdRef = useRef(0);
  const engineColumnReqIdRef = useRef(0);
  const [engineMoveEval, setEngineMoveEval] = useState<Record<string, string>>({});
  const prevImportedCountRef = useRef(0);
  const pollInFlightRef = useRef(false);
  const lastOpponentPollErrorAtRef = useRef(0);
  const lastSnapKeyRef = useRef<string>("");
  const lastAnimatedImportedCountRef = useRef<number>(0);
  const [displayTotalInPos, setDisplayTotalInPos] = useState(0);
  const [displayMoveCounts, setDisplayMoveCounts] = useState<Record<string, number>>({});
  const fetchInFlightRef = useRef(false);
  const lastFetchKeyRef = useRef<string>("");
  const fetchDebounceTimerRef = useRef<number | null>(null);
  
  // Style analysis state
  const {
    analysis: styleAnalysis,
    loading: styleLoading,
    analyze: analyzeWithStyle,
  } = useStyleAnalysis();

  useEffect(() => {
    if (!showArrow) return;
    onEvalChange(null);
    return;
  }, [showArrow, onEvalChange]);

  useEffect(() => {
    if (!showEval) {
      onEvalChange(null);
      return;
    }

    let cancelled = false;
    const reqId = (evalReqIdRef.current += 1);
    onEvalChange(null);

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const raw = await evaluatePositionShallow(state.fen, { depth: engineDepth });
          if (cancelled) return;
          if (evalReqIdRef.current !== reqId) return;

          const turn = state.game.turn();
          const whitePov: EngineScore | null =
            raw?.type === "cp"
              ? { type: "cp", value: turn === "b" ? -raw.value : raw.value }
              : raw?.type === "mate"
                ? { type: "mate", value: turn === "b" ? -raw.value : raw.value }
                : null;

          onEvalChange(whitePov);
        } catch {
          if (cancelled) return;
          if (evalReqIdRef.current !== reqId) return;
          onEvalChange(null);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [showEval, state.fen, state.game, onEvalChange, engineDepth]);

  const playTableMove = useCallback(
    (uci: string) => {
      try {
        const from = uci.slice(0, 2);
        const to = uci.slice(2, 4);
        const promotion = uci.length > 4 ? uci.slice(4) : undefined;

        const next = new Chess(state.fen);
        const played = next.move({ from, to, promotion: (promotion as any) ?? undefined });
        if (!played) return;

        state.setStatus(null);
        state.commitGame(next, played.san ?? null);
      } catch {
        // ignore invalid move
      }
    },
    [state]
  );

  const onPlayMove = useCallback(
    (uci: string) => {
      playTableMove(uci);
    },
    [playTableMove]
  );

  async function fetchOpponentStats(params: { fen: string; username: string; skipIfInFlight?: boolean }) {
    const fetchKey = `${params.username}|${params.fen}|${filtersKey}`;
    
    // Deduplicate: if a fetch is already in flight for this exact key, skip
    if (params.skipIfInFlight && fetchInFlightRef.current && lastFetchKeyRef.current === fetchKey) {
      return null;
    }
    
    fetchInFlightRef.current = true;
    lastFetchKeyRef.current = fetchKey;
    
    try {
      const json = await requestOpponentMove({
        fen: params.fen,
        username: params.username,
        mode: "proportional",
        prefetch: false,
        force_rpc: isSyncing,
      });

      const moves = Array.isArray(json?.moves) ? (json.moves as any[]) : [];
      const movesAgainst = Array.isArray(json?.moves_against) ? (json.moves_against as any[]) : [];

      const normalized = moves.map((m) => ({
        uci: String(m.uci),
        san: (m.san as string | null) ?? null,
        played_count: Number(m.played_count ?? 0),
        win: Number(m.win ?? 0),
        loss: Number(m.loss ?? 0),
        draw: Number(m.draw ?? 0),
      }));

      const normalizedAgainst = movesAgainst.map((m) => ({
        uci: String(m.uci),
        san: (m.san as string | null) ?? null,
        played_count: Number(m.played_count ?? 0),
        win: Number(m.win ?? 0),
        loss: Number(m.loss ?? 0),
        draw: Number(m.draw ?? 0),
      }));
      
      return {
        totalCountOpponent: Number(json?.available_total_count ?? 0),
        totalCountAgainst: Number(json?.available_against_total_count ?? 0),
        depthRemaining: typeof json?.depth_remaining === "number" ? (json.depth_remaining as number) : null,
        movesOpponent: normalized,
        movesAgainst: normalizedAgainst,
      };
    } finally {
      fetchInFlightRef.current = false;
    }
  }

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      setOpponentStats(null);
      return;
    }

    if (state.isGameOver) {
      setOpponentStats(null);
      setOpponentStatsBusy(false);
      return;
    }

    if (!showArrow && !enabled) {
      return;
    }

    // Clear any pending debounce timer
    if (fetchDebounceTimerRef.current != null) {
      window.clearTimeout(fetchDebounceTimerRef.current);
      fetchDebounceTimerRef.current = null;
    }

    let cancelled = false;
    setOpponentStatsBusy(true);

    // Debounce filter changes to prevent rapid refetches
    fetchDebounceTimerRef.current = window.setTimeout(() => {
      fetchDebounceTimerRef.current = null;
      
      void fetchOpponentStats({ fen: state.fen, username: trimmed, skipIfInFlight: false })
        .then((stats) => {
          if (cancelled || !stats) return;
          setOpponentStats(stats);
        })
        .catch((e) => {
          if (cancelled) return;
          const now = Date.now();
          if (now - lastOpponentPollErrorAtRef.current > 5000) {
            lastOpponentPollErrorAtRef.current = now;
            const msg = e instanceof Error ? e.message : "Opponent stats failed";
            console.warn("[AnalysisBoard] opponent stats fetch failed", msg);
          }
          setOpponentStats(null);
        })
        .finally(() => {
          if (cancelled) return;
          setOpponentStatsBusy(false);
        });
    }, 300); // 300ms debounce for filter changes

    return () => {
      cancelled = true;
      if (fetchDebounceTimerRef.current != null) {
        window.clearTimeout(fetchDebounceTimerRef.current);
        fetchDebounceTimerRef.current = null;
      }
    };
  }, [opponentUsername, filtersKey, showArrow, enabled, state.fen, opponentImportedCount, setOpponentStatsBusy, setOpponentStats]);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;
    if (!isSyncing) return;

    const timer = window.setInterval(() => {
      if (pollInFlightRef.current) return;
      // Skip polling if another fetch is already in flight
      if (fetchInFlightRef.current) return;
      
      pollInFlightRef.current = true;
      void fetchOpponentStats({ fen: state.fen, username: trimmed, skipIfInFlight: true })
        .then((stats) => {
          if (stats) {
            setOpponentStats(stats);
          }
        })
        .catch((e) => {
          const now = Date.now();
          if (now - lastOpponentPollErrorAtRef.current > 5000) {
            lastOpponentPollErrorAtRef.current = now;
            const msg = e instanceof Error ? e.message : "Opponent stats failed";
            console.warn("[AnalysisBoard] opponent stats poll failed", msg);
          }
        })
        .finally(() => {
          pollInFlightRef.current = false;
        });
    }, 2000); // Increased from 1200ms to 2000ms to reduce polling frequency

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, isSyncing, opponentUsername, state.fen, filtersKey, setOpponentStats]);

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;
    if (!enabled && !showArrow) return;
    const prev = prevImportedCountRef.current;
    prevImportedCountRef.current = opponentImportedCount;
    if (opponentImportedCount <= prev) return;
    
    // Skip if another fetch is in flight to prevent racing
    if (fetchInFlightRef.current) return;
    
    void fetchOpponentStats({ fen: state.fen, username: trimmed, skipIfInFlight: true })
      .then((stats) => {
        if (stats) {
          setOpponentStats(stats);
        }
      })
      .catch(() => {
        // Silently fail on import count changes to avoid noise
      });
  }, [opponentImportedCount, opponentUsername, showArrow, enabled, state.fen, setOpponentStats]);

  useEffect(() => {
    if (!showEngineBest) {
      setEngineBestMove(null);
      return;
    }

    setEngineBestMove(null);

    let cancelled = false;
    const reqId = (engineReqIdRef.current += 1);

    const timeout = window.setTimeout(() => {
      void evaluateBestMove(state.fen, { depth: engineDepth })
        .then((res) => {
          if (cancelled) return;
          if (engineReqIdRef.current !== reqId) return;

          const uci = res.bestMoveUci;
          if (!uci) {
            setEngineBestMove(null);
            return;
          }

          let san: string | null = null;
          try {
            const chess = new Chess(state.fen);
            const from = uci.slice(0, 2);
            const to = uci.slice(2, 4);
            const promotion = uci.length > 4 ? uci.slice(4) : undefined;
            const played = chess.move({ from, to, promotion: (promotion as any) ?? undefined });
            san = played?.san ?? null;
          } catch {
            san = null;
          }

          setEngineBestMove({ uci, san });
        })
        .catch(() => {
          if (cancelled) return;
          if (engineReqIdRef.current !== reqId) return;
          setEngineBestMove(null);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [showEngineBest, state.fen, setEngineBestMove, engineDepth]);

  const userColor = state.playerSide === "white" ? "w" : "b";
  const opponentColor = userColor === "w" ? "b" : "w";
  const isOppToMove = state.game.turn() === opponentColor;

  const nextMoveList = useMemo(() => {
    // When we have refined data from date filter, use it instead of all-time stats
    if (hasRefinedData && refinementState.refinedMoves && refinementState.refinedMoves.length > 0) {
      const refinedMoves = refinementState.refinedMoves;
      const total = refinedMoves.reduce((sum, m) => sum + m.count, 0);
      
      // Transform MoveStats to MoveRow format, converting UCI to SAN
      const tempChess = new Chess(state.fen);
      const moves: MoveRow[] = refinedMoves.map((m) => {
        // Try to convert UCI to SAN
        let san: string | null = null;
        try {
          const from = m.uci.slice(0, 2);
          const to = m.uci.slice(2, 4);
          const promotion = m.uci.length > 4 ? m.uci.slice(4) : undefined;
          const move = tempChess.move({ from, to, promotion });
          if (move) {
            san = move.san;
            tempChess.undo(); // Undo to keep position for next move
          }
        } catch {
          // If move is invalid, just use UCI
        }
        
        return {
          uci: m.uci,
          san,
          played_count: m.count,
          win: m.win,
          loss: m.loss,
          draw: m.draw,
        };
      });
      
      return { total, moves };
    }
    
    if (!opponentStats) return { total: 0, moves: [] as MoveRow[] };
    if (isOppToMove) return { total: opponentStats.totalCountOpponent, moves: opponentStats.movesOpponent as MoveRow[] };
    return { total: opponentStats.totalCountAgainst, moves: opponentStats.movesAgainst as MoveRow[] };
  }, [opponentStats, isOppToMove, hasRefinedData, refinementState.refinedMoves, state.fen]);

  const visibleMovesKey = useMemo(() => {
    return nextMoveList.moves
      .slice(0, 12)
      .map((m) => String(m.uci))
      .join("|");
  }, [nextMoveList.moves]);

  useEffect(() => {
    if (!enabled) return;
    const targetTotal = Math.max(0, Math.trunc(nextMoveList.total ?? 0));
    const targetMoves = nextMoveList.moves.slice(0, 12);

    const snapKey = `${filtersKey}|${state.fen}|${visibleMovesKey}`;
    const snapChanged = lastSnapKeyRef.current !== snapKey;
    if (snapChanged) {
      lastSnapKeyRef.current = snapKey;
    }

    const shouldAnimate = Boolean(isSyncing && !snapChanged && opponentImportedCount > lastAnimatedImportedCountRef.current);
    if (shouldAnimate) {
      lastAnimatedImportedCountRef.current = opponentImportedCount;
    }

    if (!shouldAnimate) {
      setDisplayTotalInPos(targetTotal);
      setDisplayMoveCounts(() => {
        const next: Record<string, number> = {};
        for (const m of targetMoves) {
          next[String(m.uci)] = Math.max(0, Math.trunc(m.played_count ?? 0));
        }
        return next;
      });
      return;
    }

    // Initialize missing keys so the animation has stable baselines.
    setDisplayMoveCounts((prev) => {
      let changed = false;
      const next: Record<string, number> = { ...prev };
      for (const m of targetMoves) {
        const key = String(m.uci);
        if (next[key] == null) {
          next[key] = 0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    setDisplayTotalInPos((prev) => {
      if (prev === 0) return targetTotal;
      if (prev > targetTotal) return targetTotal;
      return prev;
    });

    const timer = window.setInterval(() => {
      setDisplayTotalInPos((prev) => {
        if (prev >= targetTotal) return targetTotal;
        return prev + 1;
      });

      setDisplayMoveCounts((prev) => {
        let changed = false;
        const next: Record<string, number> = { ...prev };
        for (const m of targetMoves) {
          const k = String(m.uci);
          const target = Math.max(0, Math.trunc(m.played_count ?? 0));
          const cur = Math.max(0, Math.trunc(next[k] ?? 0));
          if (cur === target) continue;
          if (cur > target) {
            next[k] = target;
            changed = true;
            continue;
          }
          next[k] = cur + 1;
          changed = true;
        }
        return changed ? next : prev;
      });
    }, 50);

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, isSyncing, opponentImportedCount, filtersKey, state.fen, nextMoveList.total, visibleMovesKey]);

  function formatEngineScore(score: EngineScore | null) {
    if (!score) return "—";

    if (score.type === "mate") {
      const n = Math.trunc(score.value);
      if (!Number.isFinite(n) || n === 0) return "#0";
      return n > 0 ? `#${n}` : `#${n}`;
    }

    // Stockfish returns centipawns for the side to move in the evaluated position.
    // We want perspective of the side to move in the current position, so flip sign after applying a move.
    const cp = score.value;
    if (!Number.isFinite(cp)) return "—";
    const pawns = cp / 100;
    if (Math.abs(pawns) < 0.05) return "≈0.0";
    const fixed = pawns.toFixed(1);
    return pawns > 0 ? `+${fixed}` : fixed;
  }

  useEffect(() => {
    if (!enabled || !showEngineColumn) {
      setEngineMoveEval({});
      return;
    }

    // Clear immediately on any position/move-list change so values don't hang around.
    setEngineMoveEval({});

    let cancelled = false;
    const reqId = (engineColumnReqIdRef.current += 1);

    const timeout = window.setTimeout(() => {
      const moves = nextMoveList.moves.slice(0, 12);

      void (async () => {
        const out: Record<string, string> = {};

        for (const m of moves) {
          if (cancelled) return;
          if (engineColumnReqIdRef.current !== reqId) return;

          try {
            const base = new Chess(state.fen);
            const from = m.uci.slice(0, 2);
            const to = m.uci.slice(2, 4);
            const promotion = m.uci.length > 4 ? m.uci.slice(4) : undefined;
            const played = base.move({ from, to, promotion: (promotion as any) ?? undefined });
            if (!played) {
              out[m.uci] = "—";
              continue;
            }

            const score = await evaluatePositionShallow(base.fen(), { depth: engineDepth });
            // Stockfish returns score from side-to-move of the evaluated position.
            // After the move, it's the other side's turn, so we need to convert to White POV.
            const turnAfterMove = base.turn();
            const whitePov: EngineScore | null =
              score?.type === "cp"
                ? { type: "cp", value: turnAfterMove === "b" ? -score.value : score.value }
                : score?.type === "mate"
                  ? { type: "mate", value: turnAfterMove === "b" ? -score.value : score.value }
                  : null;

            out[m.uci] = formatEngineScore(whitePov);
          } catch {
            out[m.uci] = "—";
          }

          if (!cancelled && engineColumnReqIdRef.current === reqId) {
            // Progressive updates feel more responsive.
            setEngineMoveEval((prev) => ({ ...prev, [m.uci]: out[m.uci]! }));
          }
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [enabled, showEngineColumn, state.fen, visibleMovesKey, nextMoveList.moves]);

  // Style analysis effect
  useEffect(() => {
    if (!enabled || !showEngineColumn || !styleMarkers || !nextMoveList.moves?.length) {
      return;
    }

    const moves = nextMoveList.moves.slice(0, 12).map(m => m.uci);
    if (moves.length === 0) return;

    const timeout = window.setTimeout(() => {
      void analyzeWithStyle({
        fen: state.fen,
        moves,
        opponentUsername,
        styleMarkers,
      });
    }, 500); // Slight delay after engine eval

    return () => window.clearTimeout(timeout);
  }, [enabled, showEngineColumn, state.fen, nextMoveList.moves, opponentUsername, styleMarkers, analyzeWithStyle]);

  const formatGameCount = useCallback((value: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  }, []);

  const isWhiteToMove = state.game.turn() === "w";

  return (
    <div className="flex flex-col gap-2">
      {state.status ? <div className="text-xs text-zinc-600">{state.status}</div> : null}
      
      {/* Synthetic opponent info banner */}
      {isSyntheticMode && enabled && nextMoveList.moves?.length > 0 ? (
        <div className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1.5 text-[10px] text-purple-800">
          <div className="flex items-center gap-1">
            <span className="font-medium text-purple-700">Simulated opponent</span>
            <span className="mx-1">•</span>
            <span className="text-purple-600">
              {syntheticGamesCount != null ? `${syntheticGamesCount} style-matched games` : 'Loading games...'}
            </span>
          </div>
        </div>
      ) : null}

      {/* Date filter status banner - show when date filter is active (not for synthetic opponents) */}
      {!isSyntheticMode && (filterFrom || filterTo) && enabled && nextMoveList.moves?.length > 0 ? (
        <div className={`rounded-lg border px-2 py-1.5 text-[10px] ${
          hasRefinedData 
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800' 
            : 'border-blue-200 bg-blue-50 text-blue-800'
        }`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {isRefining ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                  <span className="font-medium">Refining to exact date range...</span>
                  <span className="text-blue-600">
                    ({refinementState.progress?.gamesLoaded ?? 0} games)
                  </span>
                </>
              ) : hasRefinedData ? (
                <>
                  <span className="font-medium text-emerald-700">Exact stats</span>
                  <span className="mx-1">•</span>
                  <span className="text-emerald-600">
                    {refinementState.filteredGames} of {refinementState.totalGames} games match filter
                  </span>
                </>
              ) : refinementState.status === 'unavailable' ? (
                <>
                  <span className="font-medium">All-time stats</span>
                  <span className="mx-1">•</span>
                  <span className="text-zinc-500">Date filtering requires a fresh sync</span>
                </>
              ) : refinementState.status === 'error' ? (
                <>
                  <span className="font-medium">All-time stats</span>
                  <span className="mx-1">•</span>
                  <span className="text-amber-600">Date filter failed: {refinementState.error}</span>
                </>
              ) : (
                <>
                  <span className="font-medium">All-time stats</span>
                  <span className="mx-1">•</span>
                  <span className="text-blue-600">Calculating filtered stats...</span>
                </>
              )}
            </div>
            {isRefining ? (
              <button
                type="button"
                onClick={cancelRefinement}
                className="rounded p-0.5 hover:bg-blue-100"
                title="Cancel refinement"
              >
                <X className="h-3 w-3 text-blue-600" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {enabled ? (
        <div className="grid min-w-0 gap-1">
          <div className="flex items-center justify-end">
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={showArrow}
                onChange={(e) => onShowArrowChange(e.target.checked)}
                className="h-3 w-3 rounded border-zinc-300"
              />
              Arrows
            </label>
          </div>
          {nextMoveList.moves?.length ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[280px] gap-0.5">
                <div
                  className={`grid ${
                    showEngineColumn ? "grid-cols-[56px_48px_48px_1fr_36px]" : "grid-cols-[56px_48px_1fr_36px]"
                  } gap-1 px-1 text-xs font-medium text-zinc-500`}
                >
                  <div>Move</div>
                  <div>Games</div>
                  {showEngineColumn ? <div>Eval</div> : null}
                  <div>W/D/L</div>
                  <div className="text-right">%</div>
                </div>
                {nextMoveList.moves.slice(0, 12).map((m: MoveRow) => {
                  const displayPlayed = typeof displayMoveCounts[m.uci] === "number" ? displayMoveCounts[m.uci]! : m.played_count;
                  const total = Math.max(1, m.played_count);
                  const winPct = (m.win / total) * 100;
                  const drawPct = (m.draw / total) * 100;
                  const lossPct = (m.loss / total) * 100;
                  const freq = nextMoveList.total > 0 ? m.played_count / nextMoveList.total : 0;
                  const freqPct = Math.round(freq * 100);
                  const isEngine = Boolean(engineBestMove?.uci && engineBestMove.uci === m.uci);
                  const evalLabel = showEngineColumn ? (engineMoveEval[m.uci] ?? "…") : null;
                  
                  // Get style analysis data for this move
                  const styleData = styleAnalysis?.find(s => s.move_uci === m.uci);
                  const adjustedEvalLabel = styleData && showEngineColumn 
                    ? (styleData.adjusted_eval > 0 ? `+${styleData.adjusted_eval.toFixed(1)}` : styleData.adjusted_eval.toFixed(1))
                    : null;

                  return (
                    <CandidateMoveRow
                      key={m.san ?? m.uci}
                      uci={m.uci}
                      san={m.san}
                      playedCount={displayPlayed}
                      winPct={winPct}
                      drawPct={drawPct}
                      lossPct={lossPct}
                      freqPct={freqPct}
                      isEngine={isEngine}
                      showEngineColumn={showEngineColumn}
                      evalLabel={evalLabel}
                      adjustedEvalLabel={adjustedEvalLabel}
                      styleBadges={styleData?.badges}
                      onPlay={onPlayMove}
                      formatGameCount={formatGameCount}
                      isWhiteMove={isWhiteToMove}
                    />
                  );
                })}
                <div
                  className={`grid ${
                    showEngineColumn ? "grid-cols-[56px_48px_48px_1fr_36px]" : "grid-cols-[56px_48px_1fr_36px]"
                  } gap-1 border-t border-zinc-200 px-1 py-1 text-xs font-medium text-zinc-700`}
                >
                  <div>Total</div>
                  <div>{formatGameCount(displayTotalInPos)}</div>
                  {showEngineColumn ? <div /> : null}
                  <div />
                  <div />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-600">{opponentStatsBusy ? "Loading…" : "No data for this position."}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
