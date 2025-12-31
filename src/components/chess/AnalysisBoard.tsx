"use client";

import { Chess } from "chess.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChessBoardCoreState } from "./ChessBoardCore";
import { evaluateBestMove, evaluatePositionShallow, type EngineScore } from "@/lib/engine/engineService";

type Strategy = "proportional" | "random";

type Props = {
  state: ChessBoardCoreState;
  opponentUsername: string;
  opponentImportedCount: number;
  filtersKey: string;
  requestOpponentMove: (params: { fen: string; username: string; mode: Strategy; prefetch?: boolean }) => Promise<any>;
  showArrow: boolean;
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
  onPlay: (uci: string) => void;
  formatGameCount: (n: number) => string;
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
    onPlay,
    formatGameCount,
  } = props;

  return (
    <button
      type="button"
      className={`grid ${
        showEngineColumn ? "grid-cols-[72px_68px_64px_1fr_44px]" : "grid-cols-[72px_68px_1fr_44px]"
      } items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-zinc-50 ${isEngine ? "ring-1 ring-emerald-200" : ""}`}
      onClick={() => onPlay(uci)}
    >
      <div className="flex min-w-0 items-center gap-2 text-[10px] font-medium text-zinc-900">
        <span className="min-w-0 truncate">{san ?? uci}</span>
        {isEngine ? (
          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">ENGINE</span>
        ) : null}
      </div>
      <div className="text-[10px] font-medium text-zinc-700">{formatGameCount(playedCount)}</div>
      {showEngineColumn ? <div className="min-w-0 truncate text-[10px] font-medium text-zinc-500">{evalLabel}</div> : null}
      <div className="h-3 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
        <div className="flex h-full w-full">
          <div className="h-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${winPct}%` }} />
          <div className="h-full bg-zinc-300 transition-[width] duration-200" style={{ width: `${drawPct}%` }} />
          <div className="h-full bg-rose-500 transition-[width] duration-200" style={{ width: `${lossPct}%` }} />
        </div>
      </div>
      <div className="text-right text-[10px] font-medium text-zinc-700">{freqPct}%</div>
    </button>
  );
});

export function AnalysisBoard(props: Props) {
  const {
    state,
    opponentUsername,
    opponentImportedCount,
    filtersKey,
    requestOpponentMove,
    showArrow,
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
  } = props;

  const engineReqIdRef = useRef(0);
  const evalReqIdRef = useRef(0);
  const engineColumnReqIdRef = useRef(0);
  const [engineMoveEval, setEngineMoveEval] = useState<Record<string, string>>({});
  const prevImportedCountRef = useRef(0);

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
          const raw = await evaluatePositionShallow(state.fen);
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
  }, [showEval, state.fen, state.game, onEvalChange]);

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

  async function fetchOpponentStats(params: { fen: string; username: string }) {
    const json = await requestOpponentMove({
      fen: params.fen,
      username: params.username,
      mode: "proportional",
      prefetch: false,
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
  }

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      setOpponentStats(null);
      return;
    }

    if (!showArrow && !enabled) {
      return;
    }

    let cancelled = false;
    setOpponentStatsBusy(true);

    void fetchOpponentStats({ fen: state.fen, username: trimmed })
      .then((stats) => {
        if (cancelled) return;
        setOpponentStats(stats);
      })
      .catch(() => {
        if (cancelled) return;
        setOpponentStats(null);
      })
      .finally(() => {
        if (cancelled) return;
        setOpponentStatsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [opponentUsername, filtersKey, showArrow, enabled, state.fen, opponentImportedCount, setOpponentStatsBusy, setOpponentStats]);

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;
    if (!enabled && !showArrow) return;
    const prev = prevImportedCountRef.current;
    prevImportedCountRef.current = opponentImportedCount;
    if (opponentImportedCount <= prev) return;
    setOpponentStatsBusy(true);
    void fetchOpponentStats({ fen: state.fen, username: trimmed })
      .then((stats) => {
        setOpponentStats(stats);
      })
      .catch(() => {
        setOpponentStats(null);
      })
      .finally(() => {
        setOpponentStatsBusy(false);
      });
  }, [opponentImportedCount, opponentUsername, showArrow, enabled, state.fen, setOpponentStats, setOpponentStatsBusy]);

  useEffect(() => {
    if (!showEngineBest) {
      setEngineBestMove(null);
      return;
    }

    setEngineBestMove(null);

    let cancelled = false;
    const reqId = (engineReqIdRef.current += 1);

    const timeout = window.setTimeout(() => {
      void evaluateBestMove(state.fen)
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
  }, [showEngineBest, state.fen, setEngineBestMove]);

  const userColor = state.playerSide === "white" ? "w" : "b";
  const opponentColor = userColor === "w" ? "b" : "w";
  const isOppToMove = state.game.turn() === opponentColor;

  const nextMoveList = useMemo(() => {
    if (!opponentStats) return { total: 0, moves: [] as MoveRow[] };
    if (isOppToMove) return { total: opponentStats.totalCountOpponent, moves: opponentStats.movesOpponent as MoveRow[] };
    return { total: opponentStats.totalCountAgainst, moves: opponentStats.movesAgainst as MoveRow[] };
  }, [opponentStats, isOppToMove]);

  const visibleMovesKey = useMemo(() => {
    return nextMoveList.moves
      .slice(0, 12)
      .map((m) => String(m.uci))
      .join("|");
  }, [nextMoveList.moves]);

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

            const score = await evaluatePositionShallow(base.fen());
            // Stockfish returns score from side-to-move of the evaluated position.
            // After applying a candidate move, the side-to-move flips, so invert.
            const currentTurnPov: EngineScore | null =
              score?.type === "cp"
                ? { type: "cp", value: -score.value }
                : score?.type === "mate"
                  ? { type: "mate", value: -score.value }
                  : null;

            // Display consistently as White POV (positive = good for White), matching the main eval display.
            const turn = state.game.turn();
            const whitePov: EngineScore | null =
              currentTurnPov?.type === "cp"
                ? { type: "cp", value: turn === "b" ? -currentTurnPov.value : currentTurnPov.value }
                : currentTurnPov?.type === "mate"
                  ? { type: "mate", value: turn === "b" ? -currentTurnPov.value : currentTurnPov.value }
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

  const formatGameCount = useCallback((value: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[10px] text-zinc-600">
        Turn: <span className="font-medium text-zinc-900">{state.game.turn() === "w" ? "White" : "Black"}</span>
      </div>

      {showEngineBest ? (
        <div className="min-w-0 text-[10px] text-zinc-700">
          Engine best:{" "}
          <span className="block min-w-0 truncate font-medium text-zinc-900">
            {engineBestMove ? `${engineBestMove.san ?? engineBestMove.uci}` : "—"}
          </span>
        </div>
      ) : null}

      <div className="text-[10px] text-zinc-700">
        Depth remaining (approx):{" "}
        <span className="font-medium text-zinc-900">{opponentStats?.depthRemaining == null ? "—" : String(opponentStats.depthRemaining)}</span>
      </div>

      {state.status ? <div className="text-[10px] text-zinc-600">{state.status}</div> : null}

      {enabled ? (
        <div className="grid min-w-0 gap-3">
          <div className="grid gap-0.5">
            <div className="text-[10px] font-medium text-zinc-900">Next Moves</div>
            <div className="text-[10px] text-zinc-500">Games imported: {opponentImportedCount}</div>
          </div>

          <div className="grid gap-2">
            {nextMoveList.moves?.length ? (
              <div className="overflow-x-auto">
                <div className="grid min-w-[360px] gap-2">
                  <div
                    className={`grid ${
                      showEngineColumn ? "grid-cols-[72px_68px_64px_1fr_44px]" : "grid-cols-[72px_68px_1fr_44px]"
                    } gap-2 text-[10px] font-medium text-zinc-500`}
                  >
                    <div>Move</div>
                    <div>Games</div>
                    {showEngineColumn ? <div>Engine</div> : null}
                    <div>Results</div>
                    <div className="text-right">%</div>
                  </div>
                  {nextMoveList.moves.slice(0, 12).map((m: MoveRow) => {
                    const total = Math.max(1, m.played_count);
                    const winPct = (m.win / total) * 100;
                    const drawPct = (m.draw / total) * 100;
                    const lossPct = (m.loss / total) * 100;
                    const freq = nextMoveList.total > 0 ? m.played_count / nextMoveList.total : 0;
                    const freqPct = Math.round(freq * 100);
                    const isEngine = Boolean(engineBestMove?.uci && engineBestMove.uci === m.uci);
                    const evalLabel = showEngineColumn ? (engineMoveEval[m.uci] ?? "…") : null;

                    return (
                      <CandidateMoveRow
                        key={m.san ?? m.uci}
                        uci={m.uci}
                        san={m.san}
                        playedCount={m.played_count}
                        winPct={winPct}
                        drawPct={drawPct}
                        lossPct={lossPct}
                        freqPct={freqPct}
                        isEngine={isEngine}
                        showEngineColumn={showEngineColumn}
                        evalLabel={evalLabel}
                        onPlay={onPlayMove}
                        formatGameCount={formatGameCount}
                      />
                    );
                  })}
                  <div className="text-[10px] text-zinc-500">Showing top 12 moves.</div>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-zinc-600">{opponentStatsBusy ? "Loading…" : "No data for this position."}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
