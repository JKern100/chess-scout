"use client";

import { Chess } from "chess.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateBestMove, evaluatePositionShallow, type EngineScore } from "@/lib/engine/engineService";
import type { ChessBoardCoreState } from "./ChessBoardCore";

type Strategy = "proportional" | "random";

type Props = {
  state: ChessBoardCoreState;
  opponentUsername: string;
  filtersKey: string;
  requestOpponentMove: (params: { fen: string; username: string; mode: Strategy; prefetch?: boolean }) => Promise<any>;
  showArrow: boolean;
  setShowArrow: (v: boolean) => void;
  showEval: boolean;
  setShowEval: (v: boolean) => void;
  onEvalChange: (score: EngineScore | null) => void;
  showMoveTable: boolean;
  setShowMoveTable: (v: boolean) => void;
  showEngineBest: boolean;
  setShowEngineBest: (v: boolean) => void;
  engineBestMove: { uci: string; san: string | null } | null;
  setEngineBestMove: (m: { uci: string; san: string | null } | null) => void;
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

export function AnalysisBoard(props: Props) {
  const {
    state,
    opponentUsername,
    filtersKey,
    requestOpponentMove,
    showArrow,
    setShowArrow,
    showEval,
    setShowEval,
    onEvalChange,
    showMoveTable,
    setShowMoveTable,
    showEngineBest,
    setShowEngineBest,
    engineBestMove,
    setEngineBestMove,
    opponentStats,
    setOpponentStats,
    opponentStatsBusy,
    setOpponentStatsBusy,
  } = props;

  const engineReqIdRef = useRef(0);
  const evalReqIdRef = useRef(0);
  const engineColumnReqIdRef = useRef(0);
  const [showEngineColumn, setShowEngineColumn] = useState(false);
  const [engineMoveEval, setEngineMoveEval] = useState<Record<string, string>>({});
  const [moveTableTab, setMoveTableTab] = useState<"moves" | "tab2">("moves");

  const allMoves = useMemo(() => {
    return [...state.moveHistory, ...state.redoMoves];
  }, [state.moveHistory, state.redoMoves]);

  const selectedPly = state.moveHistory.length - 1;

  function goToPly(ply: number) {
    const targetLen = ply + 1;
    const currentLen = state.moveHistory.length;
    const delta = targetLen - currentLen;
    if (delta === 0) return;
    if (delta > 0) state.redoPlies(delta);
    else state.undoPlies(-delta);
  }

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

  function playTableMove(uci: string) {
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
  }

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

    if (!showArrow && !showMoveTable) {
      return;
    }

    let cancelled = false;
    setOpponentStatsBusy(true);

    void fetchOpponentStats({ fen: state.fen, username: trimmed })
      .then((stats) => {
        if (cancelled) return;
        setOpponentStats(stats);
      })
      .finally(() => {
        if (cancelled) return;
        setOpponentStatsBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [opponentUsername, filtersKey, showArrow, showMoveTable, state.fen, setOpponentStatsBusy, setOpponentStats]);

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
    if (!showMoveTable || !showEngineColumn) {
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
  }, [showMoveTable, showEngineColumn, state.fen, visibleMovesKey, nextMoveList.moves]);

  useEffect(() => {
    if (showMoveTable) setMoveTableTab("moves");
  }, [showMoveTable]);

  function formatGameCount(value: number) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-3 text-[10px] font-medium text-white hover:bg-zinc-800"
            onClick={state.reset}
          >
            Reset
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50"
            onClick={() => state.undoPlies(1)}
          >
            Undo
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => state.undoPlies(2)}
            disabled={state.fenHistory.length <= 2}
          >
            Undo full move
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => state.redoPlies(1)}
            disabled={state.redoFens.length === 0}
          >
            Redo
          </button>
          <div className="ml-auto text-[10px] text-zinc-600">
            Turn: <span className="font-medium text-zinc-900">{state.game.turn() === "w" ? "White" : "Black"}</span>
          </div>
        </div>

        {showEngineBest ? (
          <div className="mt-3 text-[10px] text-zinc-700">
            Engine best:{" "}
            <span className="font-medium text-zinc-900">
              {engineBestMove ? `${engineBestMove.san ?? engineBestMove.uci}` : "—"}
            </span>
          </div>
        ) : null}

        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium text-zinc-900">Overlays</label>
            <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
              <input type="checkbox" checked={showArrow} onChange={(e) => setShowArrow(e.target.checked)} />
              Show candidate arrows
            </label>
            <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
              <input type="checkbox" checked={showEval} onChange={(e) => setShowEval(e.target.checked)} />
              Show eval
            </label>
            <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
              <input
                type="checkbox"
                checked={showEngineBest}
                onChange={(e) => setShowEngineBest(e.target.checked)}
              />
              Display engine’s best move
            </label>
            <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
              <input type="checkbox" checked={showMoveTable} onChange={(e) => setShowMoveTable(e.target.checked)} />
              Show move table
            </label>
            {showMoveTable ? (
              <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={showEngineColumn}
                  onChange={(e) => setShowEngineColumn(e.target.checked)}
                />
                Show engine eval column
              </label>
            ) : null}
            <div className="text-[10px] text-zinc-700">
              Depth remaining (approx):{" "}
              <span className="font-medium text-zinc-900">
                {opponentStats?.depthRemaining == null ? "—" : String(opponentStats.depthRemaining)}
              </span>
            </div>
          </div>
        </div>
        {state.status ? <div className="mt-2 text-[10px] text-zinc-600">{state.status}</div> : null}
      </div>

      {showMoveTable ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div className="text-[10px] font-medium text-zinc-900">Opponent moves</div>
            <div className="flex items-center gap-4 border-b border-zinc-200 text-[10px]">
              <button
                type="button"
                className={
                  moveTableTab === "moves"
                    ? "pb-2 font-medium text-zinc-900 border-b-2 border-zinc-900"
                    : "pb-2 font-medium text-zinc-500 hover:text-zinc-900"
                }
                onClick={() => setMoveTableTab("moves")}
              >
                Moves
              </button>
              <button
                type="button"
                className={
                  moveTableTab === "tab2"
                    ? "pb-2 font-medium text-zinc-900 border-b-2 border-zinc-900"
                    : "pb-2 font-medium text-zinc-500 hover:text-zinc-900"
                }
                onClick={() => setMoveTableTab("tab2")}
              >
                Tab 2
              </button>
            </div>
          </div>

          <div className="mt-3">
            {moveTableTab === "moves" ? (
              <div className="grid gap-2">
                {opponentStatsBusy ? (
                  <div className="text-[10px] text-zinc-600">Loading…</div>
                ) : nextMoveList.moves?.length ? (
                  <div className="grid gap-2">
                    <div
                      className={`grid ${showEngineColumn ? "grid-cols-[72px_68px_64px_1fr_44px]" : "grid-cols-[72px_68px_1fr_44px]"} gap-2 text-[10px] font-medium text-zinc-500`}
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
                        <button
                          key={m.uci}
                          type="button"
                          className={`grid ${showEngineColumn ? "grid-cols-[72px_68px_64px_1fr_44px]" : "grid-cols-[72px_68px_1fr_44px]"} items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-zinc-50 ${isEngine ? "ring-1 ring-violet-200" : ""}`}
                          onClick={() => playTableMove(m.uci)}
                        >
                          <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-900">
                            <span>{m.san ?? m.uci}</span>
                            {isEngine ? (
                              <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                ENGINE
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] font-medium text-zinc-700">{formatGameCount(m.played_count)}</div>
                          {showEngineColumn ? (
                            <div className="text-[10px] font-medium text-zinc-500">{evalLabel}</div>
                          ) : null}
                          <div className="h-3 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                            <div className="flex h-full w-full">
                              <div className="h-full bg-emerald-500" style={{ width: `${winPct}%` }} />
                              <div className="h-full bg-zinc-300" style={{ width: `${drawPct}%` }} />
                              <div className="h-full bg-rose-500" style={{ width: `${lossPct}%` }} />
                            </div>
                          </div>
                          <div className="text-right text-[10px] font-medium text-zinc-700">{freqPct}%</div>
                        </button>
                      );
                    })}
                    <div className="text-[10px] text-zinc-500">Showing top 12 moves.</div>
                  </div>
                ) : (
                  <div className="text-[10px] text-zinc-600">No data for this position.</div>
                )}
              </div>
            ) : (
              <div className="min-h-16" />
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="text-[10px] font-medium text-zinc-900">Moves</div>
        <div className="mt-2 grid gap-2 text-[10px] text-zinc-700">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={state.moveHistory.length === 0}
              onClick={() => state.undoPlies(1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              disabled={state.redoMoves.length === 0}
              onClick={() => state.redoPlies(1)}
            >
              Next
            </button>
          </div>

          {allMoves.length ? (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="grid grid-cols-[44px_1fr_1fr] bg-zinc-50 text-[10px] font-medium text-zinc-500">
                <div className="px-2 py-1">#</div>
                <div className="px-2 py-1">White</div>
                <div className="px-2 py-1">Black</div>
              </div>

              {Array.from({ length: Math.ceil(allMoves.length / 2) }).map((_, rowIdx) => {
                const whitePly = rowIdx * 2;
                const blackPly = rowIdx * 2 + 1;
                const whiteMove = allMoves[whitePly] ?? null;
                const blackMove = allMoves[blackPly] ?? null;

                const whiteSelected = selectedPly === whitePly;
                const blackSelected = selectedPly === blackPly;

                return (
                  <div key={rowIdx} className="grid grid-cols-[44px_1fr_1fr] border-t border-zinc-200">
                    <div className="px-2 py-1 text-zinc-500">{rowIdx + 1}.</div>
                    <button
                      type="button"
                      className={`px-2 py-1 text-left font-medium ${
                        whiteSelected ? "bg-sky-100 text-sky-900" : "hover:bg-zinc-50"
                      }`}
                      disabled={!whiteMove}
                      onClick={() => (whiteMove ? goToPly(whitePly) : null)}
                    >
                      {whiteMove ?? ""}
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 text-left font-medium ${
                        blackSelected ? "bg-sky-100 text-sky-900" : "hover:bg-zinc-50"
                      }`}
                      disabled={!blackMove}
                      onClick={() => (blackMove ? goToPly(blackPly) : null)}
                    >
                      {blackMove ?? ""}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-zinc-600">No moves yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function buildAnalysisArrows(state: Props) {
  const userColor = state.state.playerSide === "white" ? "w" : "b";
  const opponentColor = userColor === "w" ? "b" : "w";
  const isOppToMove = state.state.game.turn() === opponentColor;

  const nextMoveList = (() => {
    if (!state.opponentStats) return { total: 0, moves: [] as any[] };
    if (isOppToMove) return { total: state.opponentStats.totalCountOpponent, moves: state.opponentStats.movesOpponent };
    return { total: state.opponentStats.totalCountAgainst, moves: state.opponentStats.movesAgainst };
  })();

  if (!state.showArrow) return [];
  const trimmed = state.opponentUsername.trim();
  if (!trimmed) return [];
  const first = nextMoveList.moves?.[0];
  if (!first?.uci) return [];
  const uci = String(first.uci);
  if (uci.length < 4) return [];
  return [
    {
      startSquare: uci.slice(0, 2),
      endSquare: uci.slice(2, 4),
      color: "rgba(37, 99, 235, 0.9)",
    },
  ];
}
