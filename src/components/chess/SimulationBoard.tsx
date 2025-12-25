"use client";

import { useEffect, useRef } from "react";
import type { ChessBoardCoreState } from "./ChessBoardCore";

type Strategy = "proportional" | "random";

type TimeControlPreset = {
  key: string;
  label: string;
  baseMinutes: number;
  incrementSeconds: number;
  category: "bullet" | "blitz" | "rapid" | "classical";
};

type Props = {
  state: ChessBoardCoreState;
  mode: Strategy;
  setMode: (m: Strategy) => void;
  opponentUsername: string;
  setOpponentUsername: (s: string) => void;
  simBusy: boolean;
  opponentCommentary: string | null;
  lastOpponentMove: { uci: string; san: string | null } | null;
  depthRemaining: number | null;
  onOpponentMoveNow: () => void;
  engineTakeover: boolean;
  simWarmStatus: "idle" | "warming" | "warm" | "error";
  simWarmMeta: { status: string; buildMs: number; maxGames: number } | null;
  clocksEnabled: boolean;
  setClocksEnabled: (v: boolean) => void;
  timeControls: TimeControlPreset[];
  timeControlKey: string;
  setTimeControlKey: (k: string) => void;
  playerMs: number;
  opponentMs: number;
  playerLabel: string;
  opponentLabel: string;
  clockRunning: boolean;
  clockPaused: boolean;
  clockExpired: boolean;
  formatClock: (ms: number) => string;
  onClockPause: () => void;
  onClockResume: () => void;
  onClockStop: () => void;
  onReset: () => void;
  onUndo: () => void;
  onUndoFullMove: () => void;
  onRedo: () => void;
};

export function SimulationBoard(props: Props) {
  const {
    state,
    opponentUsername,
    setOpponentUsername,
    mode,
    setMode,
    simBusy,
    opponentCommentary,
    lastOpponentMove,
    depthRemaining,
    onOpponentMoveNow,
    engineTakeover,
    simWarmStatus,
    simWarmMeta,
    clocksEnabled,
    setClocksEnabled,
    timeControls,
    timeControlKey,
    setTimeControlKey,
    playerMs,
    opponentMs,
    playerLabel,
    opponentLabel,
    clockRunning,
    clockPaused,
    clockExpired,
    formatClock,
    onClockPause,
    onClockResume,
    onClockStop,
    onReset,
    onUndo,
    onUndoFullMove,
    onRedo,
  } = props;

  const canPause = clocksEnabled && clockRunning && !clockPaused && !clockExpired;
  const canResume = clocksEnabled && clockRunning && clockPaused && !clockExpired;
  const canStop = clocksEnabled;

  const lastAutoKeyRef = useRef<string | null>(null);

  const turn = state.game.turn();
  const isPlayersTurn =
    (state.playerSide === "white" && turn === "w") || (state.playerSide === "black" && turn === "b");
  const isOpponentsTurn = !isPlayersTurn;

  useEffect(() => {
    if (state.isGameOver) return;
    if (simBusy) return;
    if (!opponentUsername.trim()) return;
    if (clocksEnabled && clockExpired) return;
    if (clocksEnabled && clockPaused) return;
    if (!isOpponentsTurn) return;

    const key = `${state.fen}|${turn}|${opponentUsername}|${mode}`;
    if (lastAutoKeyRef.current === key) return;
    lastAutoKeyRef.current = key;

    onOpponentMoveNow();
  }, [
    state.fen,
    state.isGameOver,
    simBusy,
    opponentUsername,
    clocksEnabled,
    clockPaused,
    clockExpired,
    isOpponentsTurn,
    turn,
    mode,
    onOpponentMoveNow,
  ]);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-3 text-[10px] font-medium text-white hover:bg-zinc-800"
          onClick={onReset}
        >
          Reset
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50"
          onClick={onUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          onClick={onUndoFullMove}
          disabled={state.fenHistory.length <= 2}
        >
          Undo full move
        </button>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          onClick={onRedo}
          disabled={state.redoFens.length === 0}
        >
          Redo
        </button>
      </div>

      <div className="mt-3 grid gap-1.5 text-[10px] text-zinc-700">
        <div>
          Turn: <span className="font-medium text-zinc-900">{state.game.turn() === "w" ? "White" : "Black"}</span>
        </div>
        <div>
          You play:{" "}
          <span className="font-medium text-zinc-900">{state.playerSide === "white" ? "White" : "Black"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
            <input
              type="checkbox"
              checked={clocksEnabled}
              onChange={(e) => setClocksEnabled(e.target.checked)}
            />
            Enable clocks
          </label>
          {clocksEnabled ? (
            <div className="inline-flex items-center gap-2">
              <span className="text-[10px] text-zinc-600">TC</span>
              <select
                className="h-8 rounded-xl border border-zinc-200 bg-white px-2 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
                value={timeControlKey}
                onChange={(e) => setTimeControlKey(e.target.value)}
              >
                <optgroup label="Bullet">
                  {timeControls
                    .filter((t) => t.category === "bullet")
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Blitz">
                  {timeControls
                    .filter((t) => t.category === "blitz")
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Rapid">
                  {timeControls
                    .filter((t) => t.category === "rapid")
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Classical">
                  {timeControls
                    .filter((t) => t.category === "classical")
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </optgroup>
              </select>
              <span className="text-[10px] text-zinc-500">{clockExpired ? "expired" : clockRunning ? (clockPaused ? "paused" : "running") : "armed"}</span>

              <div className="ml-2 inline-flex items-center gap-2">
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                    canResume ? "bg-zinc-900 text-white" : "bg-zinc-200 text-white/60"
                  }`}
                  disabled={!canResume}
                  onClick={onClockResume}
                  aria-label="Resume clocks"
                  title="Resume"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                    canPause ? "bg-zinc-900 text-white" : "bg-zinc-200 text-white/60"
                  }`}
                  disabled={!canPause}
                  onClick={onClockPause}
                  aria-label="Pause clocks"
                  title="Pause"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
                    canStop ? "bg-zinc-900 text-white" : "bg-zinc-200 text-white/60"
                  }`}
                  disabled={!canStop}
                  onClick={onClockStop}
                  aria-label="Reset clocks"
                  title="Reset"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div>
          Side:{" "}
          <select
            className="ml-2 h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
            value={state.playerSide}
            onChange={(e) => state.setPlayerSide(e.target.value as any)}
          >
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </div>
        {state.outcome ? (
          <div>
            Result: <span className="font-medium text-zinc-900">{state.outcome}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[10px] font-medium text-zinc-900">Opponent simulation</div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-900" htmlFor="sim-opp-username">
              Opponent (Lichess username)
            </label>
            <input
              id="sim-opp-username"
              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
              value={opponentUsername}
              onChange={(e) => setOpponentUsername(e.target.value)}
              placeholder="opponent_username"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-zinc-900" htmlFor="sim-opp-mode">
              Move selection
            </label>
            <select
              id="sim-opp-mode"
              className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
            >
              <option value="proportional">Proportional (by frequency)</option>
              <option value="random">Random (uniform)</option>
            </select>
          </div>
        </div>

        <div className="grid gap-1.5 text-[10px] text-zinc-700">
          {engineTakeover ? (
            <div className="text-[10px] font-medium text-amber-700">
              Out of opponent history — engine is now playing for the opponent.
            </div>
          ) : null}
          <div>
            Cache:{" "}
            <span className="font-medium text-zinc-900">
              {simWarmStatus === "warming"
                ? "Warming…"
                : simWarmStatus === "warm"
                  ? "Warm"
                  : simWarmStatus === "error"
                    ? "Error"
                    : "—"}
            </span>
            {simWarmStatus === "warm" && simWarmMeta ? (
              <span className="text-zinc-600">{` (${simWarmMeta.status || "?"}, build ${Math.round(simWarmMeta.buildMs)}ms, ${simWarmMeta.maxGames} games)`}</span>
            ) : null}
            {simWarmStatus === "error" ? (
              <span className="text-zinc-600"> (could not load games; are you signed in?)</span>
            ) : null}
          </div>
          <div>
            Depth remaining (approx):{" "}
            <span className="font-medium text-zinc-900">{depthRemaining == null ? "—" : String(depthRemaining)}</span>
          </div>
          <div>
            Last opponent move:{" "}
            <span className="font-medium text-zinc-900">
              {lastOpponentMove ? `${lastOpponentMove.san ?? lastOpponentMove.uci}` : "—"}
            </span>
          </div>
          {opponentCommentary ? <div className="text-sm text-zinc-700">{opponentCommentary}</div> : null}
          <div className="text-[10px] text-zinc-600">
            {state.isGameOver ? "—" : simBusy ? "Opponent thinking…" : isOpponentsTurn ? "Opponent to move" : "Your move"}
          </div>
        </div>
      </div>

      {state.status ? <div className="mt-2 text-[10px] text-zinc-600">{state.status}</div> : null}
    </div>
  );
}
