"use client";

import { Chess } from "chess.js";
import { useEffect, useMemo, useState } from "react";
import type { ChessBoardCoreState } from "./ChessBoardCore";

type Strategy = "proportional" | "random";

type Props = {
  state: ChessBoardCoreState;
  opponentUsername: string;
  setOpponentUsername: (s: string) => void;
  requestOpponentMove: (params: { fen: string; username: string; mode: Strategy; prefetch?: boolean }) => Promise<any>;
  showArrow: boolean;
  setShowArrow: (v: boolean) => void;
  showMoveTable: boolean;
  setShowMoveTable: (v: boolean) => void;
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
    setOpponentUsername,
    requestOpponentMove,
    showArrow,
    setShowArrow,
    showMoveTable,
    setShowMoveTable,
    opponentStats,
    setOpponentStats,
    opponentStatsBusy,
    setOpponentStatsBusy,
  } = props;

  function playTableMove(uci: string) {
    try {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci.slice(4) : undefined;

      const next = new Chess(state.fen);
      const played = next.move({ from, to, promotion: (promotion as any) ?? undefined });
      if (!played) return;

      state.setStatus(null);
      state.commitGame(next);
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
  }, [opponentUsername, showArrow, showMoveTable, state.fen, setOpponentStatsBusy, setOpponentStats]);

  const userColor = state.playerSide === "white" ? "w" : "b";
  const opponentColor = userColor === "w" ? "b" : "w";
  const isOppToMove = state.game.turn() === opponentColor;

  const nextMoveList = useMemo(() => {
    if (!opponentStats) return { total: 0, moves: [] as MoveRow[] };
    if (isOppToMove) return { total: opponentStats.totalCountOpponent, moves: opponentStats.movesOpponent as MoveRow[] };
    return { total: opponentStats.totalCountAgainst, moves: opponentStats.movesAgainst as MoveRow[] };
  }, [opponentStats, isOppToMove]);

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
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
            onClick={state.reset}
          >
            Reset
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            onClick={() => state.undoPlies(1)}
          >
            Undo
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => state.undoPlies(2)}
            disabled={state.fenHistory.length <= 2}
          >
            Undo full move
          </button>
          <button
            type="button"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            onClick={() => state.redoPlies(1)}
            disabled={state.redoFens.length === 0}
          >
            Redo
          </button>
          <div className="ml-auto text-sm text-zinc-600">
            Turn: <span className="font-medium text-zinc-900">{state.game.turn() === "w" ? "White" : "Black"}</span>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-900" htmlFor="analysis-opp-username">
              Opponent (Lichess username)
            </label>
            <input
              id="analysis-opp-username"
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              value={opponentUsername}
              onChange={(e) => setOpponentUsername(e.target.value)}
              placeholder="opponent_username"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-900">Overlays</label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={showArrow} onChange={(e) => setShowArrow(e.target.checked)} />
              Show candidate arrows
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={showMoveTable} onChange={(e) => setShowMoveTable(e.target.checked)} />
              Show move table
            </label>
            <div className="text-sm text-zinc-700">
              Depth remaining (approx):{" "}
              <span className="font-medium text-zinc-900">
                {opponentStats?.depthRemaining == null ? "—" : String(opponentStats.depthRemaining)}
              </span>
            </div>
          </div>
        </div>

        {showMoveTable ? (
          <div className="mt-4 grid gap-2">
            {opponentStatsBusy ? (
              <div className="text-sm text-zinc-600">Loading…</div>
            ) : nextMoveList.moves?.length ? (
              <div className="grid gap-2">
                <div className="grid grid-cols-[80px_80px_1fr_56px] gap-2 text-xs font-medium text-zinc-500">
                  <div>Move</div>
                  <div>Games</div>
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

                  return (
                    <button
                      key={m.uci}
                      type="button"
                      className="grid grid-cols-[80px_80px_1fr_56px] items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-zinc-50"
                      onClick={() => playTableMove(m.uci)}
                    >
                      <div className="text-sm font-medium text-zinc-900">{m.san ?? m.uci}</div>
                      <div className="text-sm font-medium text-zinc-700">{formatGameCount(m.played_count)}</div>
                      <div className="h-3 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                        <div className="flex h-full w-full">
                          <div className="h-full bg-emerald-500" style={{ width: `${winPct}%` }} />
                          <div className="h-full bg-zinc-300" style={{ width: `${drawPct}%` }} />
                          <div className="h-full bg-rose-500" style={{ width: `${lossPct}%` }} />
                        </div>
                      </div>
                      <div className="text-right text-sm font-medium text-zinc-700">{freqPct}%</div>
                    </button>
                  );
                })}
                <div className="text-xs text-zinc-500">Showing top 12 moves.</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-600">No data for this position.</div>
            )}
          </div>
        ) : null}

        {state.status ? <div className="mt-3 text-sm text-zinc-600">{state.status}</div> : null}
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-medium text-zinc-900">Moves</div>
        <div className="mt-3 grid gap-1 text-sm text-zinc-700">
          {state.game.history().length ? (
            <div className="whitespace-pre-wrap break-words">
              {state.game.history().map((m, idx) => (
                <span key={idx}>
                  {m}
                  {idx < state.game.history().length - 1 ? " " : ""}
                </span>
              ))}
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
