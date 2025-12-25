"use client";

import { Chess } from "chess.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBestMoveForPlay } from "@/lib/engine/engineService";
import { AnalysisBoard } from "./AnalysisBoard";
import { ChessBoardCore, type ChessBoardCoreState } from "./ChessBoardCore";
import { SimulationBoard } from "./SimulationBoard";

type Props = {
  initialFen?: string;
};

type Mode = "simulation" | "analysis";

type Strategy = "proportional" | "random";

type TimeControlCategory = "bullet" | "blitz" | "rapid" | "classical";

type TimeControlPreset = {
  key: string;
  label: string;
  baseMinutes: number;
  incrementSeconds: number;
  category: TimeControlCategory;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatClock(ms: number) {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (safe < 60_000) {
    const tenths = Math.floor((safe % 1000) / 100);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function randomInt(min: number, max: number) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function computeOpponentThinkDelayMs(category: TimeControlCategory, remainingMs: number) {
  // Training realism, not punishment: keep responsive.
  // Also never burn more than a small fraction of remaining time.
  const [baseMin, baseMax] =
    category === "bullet"
      ? [150, 400]
      : category === "blitz"
        ? [300, 900]
        : category === "rapid"
          ? [600, 1500]
          : [900, 2200];

  const raw = randomInt(baseMin, baseMax);
  const cap = Math.max(0, Math.min(remainingMs - 50, Math.floor(remainingMs * 0.25)));
  return Math.max(0, Math.min(raw, cap));
}

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

  const [engineTakeover, setEngineTakeover] = useState(false);
  const [engineTakeoverFlash, setEngineTakeoverFlash] = useState(false);
  const prevEngineTakeoverRef = useRef(false);

  useEffect(() => {
    const prev = prevEngineTakeoverRef.current;
    prevEngineTakeoverRef.current = engineTakeover;
    if (!prev && engineTakeover) {
      setEngineTakeoverFlash(true);
      const id = window.setTimeout(() => setEngineTakeoverFlash(false), 900);
      return () => window.clearTimeout(id);
    }
  }, [engineTakeover]);

  const timeControls: TimeControlPreset[] = useMemo(
    () => [
      { key: "1+0", label: "1+0", baseMinutes: 1, incrementSeconds: 0, category: "bullet" },
      { key: "2+1", label: "2+1", baseMinutes: 2, incrementSeconds: 1, category: "bullet" },
      { key: "3+0", label: "3+0", baseMinutes: 3, incrementSeconds: 0, category: "blitz" },
      { key: "3+2", label: "3+2", baseMinutes: 3, incrementSeconds: 2, category: "blitz" },
      { key: "5+0", label: "5+0", baseMinutes: 5, incrementSeconds: 0, category: "blitz" },
      { key: "5+3", label: "5+3", baseMinutes: 5, incrementSeconds: 3, category: "blitz" },
      { key: "10+0", label: "10+0", baseMinutes: 10, incrementSeconds: 0, category: "rapid" },
      { key: "10+5", label: "10+5", baseMinutes: 10, incrementSeconds: 5, category: "rapid" },
      { key: "15+10", label: "15+10", baseMinutes: 15, incrementSeconds: 10, category: "rapid" },
      { key: "30+0", label: "30+0", baseMinutes: 30, incrementSeconds: 0, category: "classical" },
      { key: "30+20", label: "30+20", baseMinutes: 30, incrementSeconds: 20, category: "classical" },
    ],
    []
  );

  const [clocksEnabled, setClocksEnabled] = useState(false);
  const [timeControlKey, setTimeControlKey] = useState<string>("3+2");
  const [clockRunning, setClockRunning] = useState(false);
  const [clockPaused, setClockPaused] = useState(false);
  const [clockExpired, setClockExpired] = useState(false);
  const [whiteMs, setWhiteMs] = useState<number>(3 * 60_000);
  const [blackMs, setBlackMs] = useState<number>(3 * 60_000);

  const tickRef = useRef<{ lastTs: number | null }>({ lastTs: null });
  const simMetaRef = useRef<{ turn: "w" | "b"; isGameOver: boolean }>({ turn: "w", isGameOver: false });

  const selectedTc = useMemo(() => {
    return timeControls.find((t) => t.key === timeControlKey) ?? timeControls[0];
  }, [timeControlKey, timeControls]);

  const incrementMs = selectedTc.incrementSeconds * 1000;

  const resetClocksToSelected = useCallback(() => {
    const startMs = selectedTc.baseMinutes * 60_000;
    setWhiteMs(startMs);
    setBlackMs(startMs);
    setClockRunning(false);
    setClockPaused(false);
    setClockExpired(false);
    tickRef.current.lastTs = null;
  }, [selectedTc]);

  useEffect(() => {
    if (!clocksEnabled) {
      setClockRunning(false);
      setClockExpired(false);
      tickRef.current.lastTs = null;
      return;
    }
    resetClocksToSelected();
  }, [clocksEnabled, resetClocksToSelected]);

  useEffect(() => {
    if (!clocksEnabled) return;
    resetClocksToSelected();
  }, [timeControlKey, clocksEnabled, resetClocksToSelected]);

  useEffect(() => {
    if (mode !== "simulation") return;
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockPaused) return;
    if (clockExpired) return;

    const id = window.setInterval(() => {
      if (simMetaRef.current.isGameOver) return;
      const now = Date.now();
      const last = tickRef.current.lastTs;
      tickRef.current.lastTs = now;
      if (last == null) return;
      const dt = Math.max(0, Math.min(2000, now - last));
      const turn = simMetaRef.current.turn;

      if (turn === "w") {
        setWhiteMs((prev) => {
          const next = prev - dt;
          if (next <= 0) {
            setClockExpired(true);
            setClockRunning(false);
            return 0;
          }
          return next;
        });
      } else {
        setBlackMs((prev) => {
          const next = prev - dt;
          if (next <= 0) {
            setClockExpired(true);
            setClockRunning(false);
            return 0;
          }
          return next;
        });
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [mode, clocksEnabled, clockRunning, clockPaused, clockExpired]);

  const pauseClocks = useCallback(() => {
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockExpired) return;
    setClockPaused(true);
  }, [clocksEnabled, clockRunning, clockExpired]);

  const resumeClocks = useCallback(() => {
    if (!clocksEnabled) return;
    if (!clockRunning) return;
    if (clockExpired) return;
    setClockPaused(false);
    tickRef.current.lastTs = Date.now();
  }, [clocksEnabled, clockRunning, clockExpired]);

  const stopClocks = useCallback(() => {
    if (!clocksEnabled) return;
    resetClocksToSelected();
  }, [clocksEnabled, resetClocksToSelected]);

  const [analysisShowArrow, setAnalysisShowArrow] = useState(true);
  const [analysisShowMoveTable, setAnalysisShowMoveTable] = useState(false);
  const [analysisShowEngineBest, setAnalysisShowEngineBest] = useState(false);
  const [analysisEngineBestUci, setAnalysisEngineBestUci] = useState<string | null>(null);
  const [analysisEngineBestSan, setAnalysisEngineBestSan] = useState<string | null>(null);
  const [analysisStats, setAnalysisStats] = useState<Stats | null>(null);
  const [analysisStatsBusy, setAnalysisStatsBusy] = useState(false);

  const opponentSource = engineTakeover ? "engine" : "history";

  const opponentSourceIndicator = useMemo(() => {
    if (mode !== "simulation") return null;
    if (!opponentUsername.trim()) return null;

    const flash = opponentSource === "engine" && engineTakeoverFlash;
    const baseClass = "inline-flex h-6 w-6 items-center justify-center rounded-md";
    const className = flash
      ? `${baseClass} bg-amber-200 text-amber-900 animate-pulse`
      : `${baseClass} bg-zinc-200 text-zinc-700`;

    return (
      <span className={className} title={opponentSource === "history" ? "Opponent history" : "Engine"} aria-label={opponentSource === "history" ? "Opponent history" : "Engine"}>
        {opponentSource === "history" ? (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M12 2c-4.97 0-9 1.79-9 4v12c0 2.21 4.03 4 9 4s9-1.79 9-4V6c0-2.21-4.03-4-9-4zm0 2c3.87 0 7 .99 7 2s-3.13 2-7 2-7-.99-7-2 3.13-2 7-2zm0 16c-3.87 0-7-.99-7-2v-2.11C6.45 16.53 9.08 17 12 17s5.55-.47 7-1.11V18c0 1.01-3.13 2-7 2zm0-5c-3.87 0-7-.99-7-2v-2.11C6.45 11.53 9.08 12 12 12s5.55-.47 7-1.11V13c0 1.01-3.13 2-7 2z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.7 7.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.4.31.64.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.24.09.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
          </svg>
        )}
      </span>
    );
  }, [engineTakeoverFlash, mode, opponentSource, opponentUsername]);

  const handleSetEngineBestMove = useCallback((next: { uci: string; san: string | null } | null) => {
    setAnalysisEngineBestUci(next?.uci ?? null);
    setAnalysisEngineBestSan(next?.san ?? null);
  }, []);

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

    if (clocksEnabled && clockExpired) {
      state.setStatus("Time expired (training mode).");
      return;
    }

    if (clocksEnabled && clockPaused) {
      state.setStatus("Clocks paused.");
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
        setEngineTakeover(true);

        const bestUci = await getBestMoveForPlay(fen);
        if (!bestUci) {
          state.setStatus("Out of opponent history at this position, and engine could not find a move.");
          return;
        }

        const reply = new Chess(fen);
        const from = bestUci.slice(0, 2);
        const to = bestUci.slice(2, 4);
        const promotion = bestUci.length > 4 ? bestUci.slice(4) : undefined;

        const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
        if (!played) {
          state.setStatus("Engine move was not legal in this position.");
          return;
        }

        if (clocksEnabled && clockRunning && !clockPaused && !clockExpired) {
          const remaining = state.game.turn() === "w" ? whiteMs : blackMs;
          const delayMs = computeOpponentThinkDelayMs(selectedTc.category, remaining);
          if (delayMs > 0) await sleep(delayMs);
          const inc = incrementMs;
          if (inc > 0) {
            if (state.game.turn() === "w") setWhiteMs((t) => t + inc);
            else setBlackMs((t) => t + inc);
          }
        }

        setLastOpponentMove({ uci: bestUci, san: played.san ?? null });
        setOpponentCommentary("Out of opponent history — engine is now playing for the opponent.");
        state.setStatus(null);
        state.commitGame(reply);
        return;
      }

      setEngineTakeover(false);

      const reply = new Chess(fen);
      const from = String(move.uci).slice(0, 2);
      const to = String(move.uci).slice(2, 4);
      const promotion = String(move.uci).length > 4 ? String(move.uci).slice(4) : undefined;

      const played = reply.move({ from, to, promotion: (promotion as any) ?? undefined });
      if (!played) {
        state.setStatus("Opponent move from history was not legal in this position.");
        return;
      }

      if (clocksEnabled && clockRunning && !clockPaused && !clockExpired) {
        const remaining = state.game.turn() === "w" ? whiteMs : blackMs;
        const delayMs = computeOpponentThinkDelayMs(selectedTc.category, remaining);
        if (delayMs > 0) await sleep(delayMs);
        const inc = incrementMs;
        if (inc > 0) {
          if (state.game.turn() === "w") setWhiteMs((t) => t + inc);
          else setBlackMs((t) => t + inc);
        }
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

    if (clocksEnabled && clockExpired) {
      state.setStatus("Time expired (training mode).");
      return false;
    }

    try {
      const next = new Chess(state.fen);
      const move = next.move({ from: sourceSquare, to: targetSquare, promotion: "q" });
      if (!move) return false;

      if (clocksEnabled && !clockPaused && !clockRunning && !clockExpired) {
        setClockRunning(true);
        tickRef.current.lastTs = Date.now();
      }

      if (clocksEnabled && clockRunning && !clockPaused && !clockExpired && incrementMs > 0) {
        if (state.game.turn() === "w") setWhiteMs((t) => t + incrementMs);
        else setBlackMs((t) => t + incrementMs);
      }

      state.commitGame(next);
      void playOpponentNow(state, next.fen());
      return true;
    } catch {
      return false;
    }
  }

  const onSimReset = useCallback(
    (state: ChessBoardCoreState) => {
      state.reset();
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const onSimUndoPlies = useCallback(
    (state: ChessBoardCoreState, plies: number) => {
      state.undoPlies(plies);
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const onSimRedoPlies = useCallback(
    (state: ChessBoardCoreState, plies: number) => {
      state.redoPlies(plies);
      if (clocksEnabled) resetClocksToSelected();
    },
    [clocksEnabled, resetClocksToSelected]
  );

  const underBoard = (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[10px] font-medium text-zinc-900">Mode</div>
        <div className="inline-flex overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <button
            type="button"
            className={`h-8 px-3 text-[10px] font-medium ${mode === "simulation" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"}`}
            onClick={() => setMode("simulation")}
          >
            Game Simulation
          </button>
          <button
            type="button"
            className={`h-8 px-3 text-[10px] font-medium ${mode === "analysis" ? "bg-zinc-900 text-white" : "text-zinc-900 hover:bg-zinc-50"}`}
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
      aboveBoard={(state) => {
        if (mode !== "simulation") return null;

        if (!clocksEnabled) {
          if (!opponentSourceIndicator) return null;
          return <div className="flex justify-start">{opponentSourceIndicator}</div>;
        }

        const playerColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = playerColor === "w" ? "b" : "w";
        const isActive = state.game.turn() === opponentColor && clockRunning && !clockPaused && !clockExpired;

        const oppMs = state.playerSide === "white" ? blackMs : whiteMs;
        const isLow = oppMs <= 10_000;

        return (
          <div
            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 font-mono text-2xl tabular-nums ${
              isActive
                ? isLow
                  ? "border-rose-300 bg-rose-600 text-white"
                  : "border-zinc-200 bg-zinc-900 text-white"
                : isLow
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700"
            }`}
          >
            <div className="flex items-center">
              {opponentSourceIndicator ? <span className="mr-2">{opponentSourceIndicator}</span> : null}
            </div>
            <div className="flex items-center justify-end">{formatClock(oppMs)}</div>
          </div>
        );
      }}
      belowBoard={(state) => {
        if (mode !== "simulation") return null;
        if (!clocksEnabled) return null;

        const playerColor = state.playerSide === "white" ? "w" : "b";
        const isActive = state.game.turn() === playerColor && clockRunning && !clockPaused && !clockExpired;

        const pMs = state.playerSide === "white" ? whiteMs : blackMs;
        const isLow = pMs <= 10_000;

        return (
          <div
            className={`flex items-center justify-end rounded-xl border px-3 py-2 font-mono text-2xl tabular-nums ${
              isActive
                ? isLow
                  ? "border-rose-300 bg-rose-600 text-white"
                  : "border-zinc-200 bg-zinc-900 text-white"
                : isLow
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-zinc-200 bg-zinc-100 text-zinc-700"
            }`}
          >
            {formatClock(pMs)}
          </div>
        );
      }}
      specialArrow={(state) => {
        if (mode !== "analysis") return null;
        if (!analysisShowArrow) return null;

        const engineUci = analysisShowEngineBest && analysisEngineBestUci ? String(analysisEngineBestUci) : null;
        if (!engineUci || engineUci.length < 4) return null;

        const trimmed = opponentUsername.trim();
        if (!trimmed) return null;
        if (!analysisStats) return null;

        const userColor = state.playerSide === "white" ? "w" : "b";
        const opponentColor = userColor === "w" ? "b" : "w";
        const isOppToMove = state.game.turn() === opponentColor;

        const total = isOppToMove ? analysisStats.totalCountOpponent : analysisStats.totalCountAgainst;
        if (!Number.isFinite(total) || total <= 0) return null;

        const moves = isOppToMove ? analysisStats.movesOpponent : analysisStats.movesAgainst;
        const top = (moves ?? []).slice(0, 8);
        if (top.length === 0) return null;

        const mostCommon = String(top[0]?.uci ?? "");
        if (!mostCommon || mostCommon !== engineUci) return null;

        const played = Number(top[0]?.played_count ?? 0);
        const freq = played > 0 ? played / total : 0;
        const intensity = Math.max(0, Math.min(1, freq));

        return { startSquare: engineUci.slice(0, 2), endSquare: engineUci.slice(2, 4), intensity };
      }}
      arrows={(state) => {
        if (mode !== "analysis") return [];
        const arrowsOut: any[] = [];

        const engineUci = analysisShowEngineBest && analysisEngineBestUci ? String(analysisEngineBestUci) : null;

        if (!analysisShowArrow) {
          if (engineUci && engineUci.length >= 4) {
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: "rgba(34, 197, 94, 0.9)",
            });
          }
          return arrowsOut;
        }
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

        const mostCommonUci = String(top[0]?.uci ?? "");

        // Combined case: engine best == most common opponent move.
        // Render exactly one arrow: opponent blue with opacity driven by opponent frequency.
        if (engineUci && engineUci.length >= 4) {
          if (engineUci === mostCommonUci) {
            // Combined case: keep normal/high opacity like other arrows.
            // Use the same normalization approach as the other candidate arrows (freq / maxFreq).
            const played = Number(top[0]?.played_count ?? 0);
            const freq = played > 0 ? played / total : 0;
            const opacity = Math.max(MIN_OPACITY, freq / maxFreq);
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: `rgba(37, 99, 235, ${opacity.toFixed(3)})`,
            });
          } else {
            arrowsOut.push({
              startSquare: engineUci.slice(0, 2),
              endSquare: engineUci.slice(2, 4),
              color: "rgba(34, 197, 94, 0.9)",
            });
          }
        }

        arrowsOut.push(
          ...top
            .map((m) => {
              const uci = String(m.uci ?? "");
              if (uci.length < 4) return null;
              if (engineUci && uci === engineUci) return null;
              const freq = Number(m.played_count ?? 0) / total;
              const opacity = Math.max(MIN_OPACITY, freq / maxFreq);

              return {
                startSquare: uci.slice(0, 2),
                endSquare: uci.slice(2, 4),
                color: `rgba(37, 99, 235, ${opacity.toFixed(3)})`,
              };
            })
            .filter(Boolean)
        );

        const seen = new Set<string>();
        const deduped: any[] = [];
        for (const a of arrowsOut) {
          const start = String(a?.startSquare ?? "");
          const end = String(a?.endSquare ?? "");
          if (!start || !end) continue;
          const key = `${start}-${end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(a);
        }

        return deduped;
      }}
      onPieceDrop={onPieceDrop}
      underBoard={underBoard}
    >
      {(state) => {
        if (mode === "simulation") {
          simMetaRef.current.turn = state.game.turn();
          simMetaRef.current.isGameOver = state.isGameOver;
          if (clocksEnabled && clockExpired && !state.isGameOver) {
            state.setStatus("Time expired (training mode).");
          }
        }
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
              showEngineBest={analysisShowEngineBest}
              setShowEngineBest={setAnalysisShowEngineBest}
              engineBestMove={
                analysisEngineBestUci
                  ? { uci: analysisEngineBestUci, san: analysisEngineBestSan }
                  : null
              }
              setEngineBestMove={handleSetEngineBestMove}
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
            opponentCommentary={opponentCommentary}
            lastOpponentMove={lastOpponentMove}
            depthRemaining={depthRemaining}
            onOpponentMoveNow={() => void playOpponentNow(state)}
            engineTakeover={engineTakeover}
            simWarmStatus={simWarmStatus}
            simWarmMeta={simWarmMeta}
            clocksEnabled={clocksEnabled}
            setClocksEnabled={setClocksEnabled}
            timeControls={timeControls}
            timeControlKey={timeControlKey}
            setTimeControlKey={setTimeControlKey}
            playerMs={state.playerSide === "white" ? whiteMs : blackMs}
            opponentMs={state.playerSide === "white" ? blackMs : whiteMs}
            playerLabel={state.playerSide === "white" ? "White" : "Black"}
            opponentLabel={state.playerSide === "white" ? "Black" : "White"}
            clockRunning={clockRunning}
            clockPaused={clockPaused}
            clockExpired={clockExpired}
            formatClock={formatClock}
            onClockPause={pauseClocks}
            onClockResume={resumeClocks}
            onClockStop={stopClocks}
            onReset={() => onSimReset(state)}
            onUndo={() => onSimUndoPlies(state, 1)}
            onUndoFullMove={() => onSimUndoPlies(state, 2)}
            onRedo={() => onSimRedoPlies(state, 1)}
          />
        );
      }}
    </ChessBoardCore>
  );
}
