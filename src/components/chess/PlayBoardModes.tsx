"use client";

import { Chess } from "chess.js";
import { useEffect, useState } from "react";
import { AnalysisBoard } from "./AnalysisBoard";
import { ChessBoardCore, type ChessBoardCoreState } from "./ChessBoardCore";
import { SimulationBoard } from "./SimulationBoard";

type Props = {
  initialFen?: string;
};

type Mode = "simulation" | "analysis";

type Strategy = "proportional" | "random";

type Stats = {
  totalCountOpponent: number;
  totalCountAgainst: number;
  depthRemaining: number | null;
  movesOpponent: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
  movesAgainst: Array<{ uci: string; san: string | null; played_count: number; win: number; loss: number; draw: number }>;
};

export function PlayBoardModes({ initialFen }: Props) {
  const [mode, setMode] = useState<Mode>("simulation");

  const [opponentUsername, setOpponentUsername] = useState<string>("");
  const [opponentMode, setOpponentMode] = useState<Strategy>("proportional");
  const [depthRemaining, setDepthRemaining] = useState<number | null>(null);
  const [lastOpponentMove, setLastOpponentMove] = useState<{ uci: string; san: string | null } | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [opponentCommentary, setOpponentCommentary] = useState<string | null>(null);

  const [simWarmStatus, setSimWarmStatus] = useState<"idle" | "warming" | "warm" | "error">("idle");
  const [simWarmMeta, setSimWarmMeta] = useState<{ status: string; buildMs: number; maxGames: number } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const [analysisShowArrow, setAnalysisShowArrow] = useState(true);
  const [analysisShowMoveTable, setAnalysisShowMoveTable] = useState(false);
  const [analysisStats, setAnalysisStats] = useState<Stats | null>(null);
  const [analysisStatsBusy, setAnalysisStatsBusy] = useState(false);

  async function requestOpponentMove(params: {
    fen: string;
    username: string;
    mode: Strategy;
    prefetch?: boolean;
  }) {
    const res = await fetch("/api/sim/next-move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: "lichess",
        username: params.username,
        fen: params.fen,
        mode: params.mode,
        max_games: 2000,
        max_depth: 16,
        prefetch: params.prefetch ?? false,
      }),
    });

    const json = await res.json();
    if (!res.ok) {
      const message = String(json?.error ?? "Opponent simulation failed");
      throw new Error(message);
    }
    return json as any;
  }

  useEffect(() => {
    const trimmed = opponentUsername.trim();
    if (!trimmed) return;

    let cancelled = false;
    setSimWarmStatus("warming");
    setSimError(null);

    void requestOpponentMove({
      fen: new Chess().fen(),
      username: trimmed,
      mode: opponentMode,
      prefetch: true,
    })
      .then((json) => {
        if (cancelled) return;
        setSimWarmMeta({
          status: String(json?.cache?.status ?? ""),
          buildMs: Number(json?.cache?.build_ms ?? 0),
          maxGames: Number(json?.cache?.max_games ?? 0),
        });
        setSimWarmStatus("warm");
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Opponent simulation failed";
        setSimError(msg);
        setSimWarmStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [opponentUsername, opponentMode]);

  async function playOpponentNow(state: ChessBoardCoreState, fenOverride?: string) {
    const trimmed = opponentUsername.trim();
    if (!trimmed) {
      state.setStatus("Enter an opponent username to simulate opponent moves.");
      return;
    }

    const shouldOpponentMove =
      (state.playerSide === "white" && state.game.turn() === "b") ||
      (state.playerSide === "black" && state.game.turn() === "w");
    if (!shouldOpponentMove) return;
    if (state.isGameOver) return;

    const fen = fenOverride ?? state.fen;

    setSimBusy(true);
    setSimError(null);
    try {
      const json = await requestOpponentMove({ fen, username: trimmed, mode: opponentMode });
      setDepthRemaining(typeof json?.depth_remaining === "number" ? (json.depth_remaining as number) : null);

      const move = json?.move as any;
      if (!move?.uci) {
        setLastOpponentMove(null);
        setOpponentCommentary(null);
        state.setStatus(
          "Out of opponent history at this position. Continue vs engine (coming soon) or switch to Analysis Mode."
        );
        return;
      }

      const reply = new Chess(fen);
      const from = String(move.uci).slice(0, 2);
      const to = String(move.uci).slice(2, 4);
      const promotion = String(move.uci).length > 4 ? String(move.uci).slice(4) : undefined;

      const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
      if (!played) {
        state.setStatus("Opponent move from history was not legal in this position.");
        return;
      }

      setLastOpponentMove({ uci: String(move.uci), san: (move.san as string | null) ?? null });
      setOpponentCommentary(
        `${trimmed} plays ${(move.san as string | null) ?? move.uci}. Switch to Analysis Mode to explore alternatives.`
      );
      state.setStatus(null);
      state.commitGame(reply);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Opponent simulation failed";
      setSimError(msg);
      state.setStatus(
        msg.toLowerCase().includes("unauthorized")
          ? "You need to sign in to use opponent simulation. Go back to the home page and sign in first."
          : `Opponent simulation failed: ${msg}`
      );
    } finally {
      setSimBusy(false);
    }
  }

  function onPieceDrop(args: any, state: ChessBoardCoreState) {
    state.setStatus(null);

    const sourceSquare = args?.sourceSquare as string | undefined;
    const targetSquare = args?.targetSquare as string | null | undefined;
    if (!sourceSquare || !targetSquare) return false;

    if (mode === "analysis") {
      try {
        const next = new Chess(state.fen);
        const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
        if (!move) return false;
        state.commitGame(next);
        return true;
      } catch {
        return false;
      }
    }

    const isPlayersTurn =
      (state.playerSide === "white" && state.game.turn() === "w") ||
      (state.playerSide === "black" && state.game.turn() === "b");
    if (!isPlayersTurn) return false;

    try {
      const next = new Chess(state.fen);
      const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (!move) return false;
      state.commitGame(next);
      void playOpponentNow(state, next.fen());
      return true;
    } catch {
      return false;
    }
  }

  const underBoard = (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium text-zinc-900">Mode</div>
        <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <button
            type="button"
            className={`h-10 px-4 text-sm font-medium ${mode === "simulation" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"}`}
            onClick={() => setMode("simulation")}
          >
            Game Simulation
          </button>
          <button
            type="button"
            className={`h-10 px-4 text-sm font-medium ${mode === "analysis" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"}`}
            onClick={() => setMode("analysis")}
          >
            Analysis
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <ChessBoardCore
      initialFen={initialFen}
      arrows={(state) => {
        if (mode !== "analysis") return [];
        if (!analysisShowArrow) return [];
        const trimmed = opponentUsername.trim();
        if (!trimmed) return [];
        if (!analysisStats) return [];

        const TOP_N = 8;
        const MIN_OPACITY = 0.15;

        const userColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = userColor === "w" ? "b" : "w";
        const isOppToMove = state.game.turn() === opponentColor;

        const total = isOppToMove ? analysisStats.totalCountOpponent : analysisStats.totalCountAgainst;
        if (!Number.isFinite(total) || total <= 0) return [];

        const moves = isOppToMove ? analysisStats.movesOpponent : analysisStats.movesAgainst;
        const top = (moves ?? []).slice(0, TOP_N);
        if (top.length === 0) return [];

        const maxFreq = Math.max(
          ...top.map((m) => (Number(m.played_count ?? 0) > 0 ? Number(m.played_count ?? 0) / total : 0))
        );
        if (!Number.isFinite(maxFreq) || maxFreq <= 0) return [];

        return top
          .map((m) => {
            const uci = String(m.uci ?? "");
            if (uci.length < 4) return null;
            const freq = Number(m.played_count ?? 0) / total;
            const opacity = Math.max(MIN_OPACITY, freq / maxFreq);

            return {
              startSquare: uci.slice(0, 2),
              endSquare: uci.slice(2, 4),
              color: `rgba(37, 99, 235, ${opacity.toFixed(3)})`,
            };
          })
          .filter(Boolean);
      }}
      onPieceDrop={onPieceDrop}
      underBoard={underBoard}
    >
      {(state) => {
        if (mode === "analysis") {
          return (
            <AnalysisBoard
              state={state}
              opponentUsername={opponentUsername}
              setOpponentUsername={setOpponentUsername}
              requestOpponentMove={requestOpponentMove}
              showArrow={analysisShowArrow}
              setShowArrow={setAnalysisShowArrow}
              showMoveTable={analysisShowMoveTable}
              setShowMoveTable={setAnalysisShowMoveTable}
              opponentStatsBusy={analysisStatsBusy}
              opponentStats={analysisStats}
              setOpponentStats={setAnalysisStats}
              setOpponentStatsBusy={setAnalysisStatsBusy}
            />
          );
        }

        return (
          <SimulationBoard
            state={state}
            mode={opponentMode}
            setMode={setOpponentMode}
            opponentUsername={opponentUsername}
            setOpponentUsername={setOpponentUsername}
            simBusy={simBusy}
            setSimBusy={setSimBusy}
            opponentCommentary={opponentCommentary}
            setOpponentCommentary={setOpponentCommentary}
            lastOpponentMove={lastOpponentMove}
            setLastOpponentMove={setLastOpponentMove}
            depthRemaining={depthRemaining}
            setDepthRemaining={setDepthRemaining}
            onOpponentMoveNow={() => void playOpponentNow(state)}
            simWarmStatus={simWarmStatus}
            simWarmMeta={simWarmMeta}
          />
        );
      }}
    </ChessBoardCore>
  );
}
