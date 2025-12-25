"use client";

import type { ChessBoardCoreState } from "./ChessBoardCore";

type Strategy = "proportional" | "random";

type Props = {
  state: ChessBoardCoreState;
  mode: Strategy;
  setMode: (m: Strategy) => void;
  opponentUsername: string;
  setOpponentUsername: (s: string) => void;
  simBusy: boolean;
  setSimBusy: (v: boolean) => void;
  opponentCommentary: string | null;
  setOpponentCommentary: (s: string | null) => void;
  lastOpponentMove: { uci: string; san: string | null } | null;
  setLastOpponentMove: (m: { uci: string; san: string | null } | null) => void;
  depthRemaining: number | null;
  setDepthRemaining: (n: number | null) => void;
  onOpponentMoveNow: () => void;
  simWarmStatus: "idle" | "warming" | "warm" | "error";
  simWarmMeta: { status: string; buildMs: number; maxGames: number } | null;
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
    simWarmStatus,
    simWarmMeta,
  } = props;

  return (
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
      </div>

      <div className="mt-4 grid gap-2 text-sm text-zinc-700">
        <div>
          Turn: <span className="font-medium text-zinc-900">{state.game.turn() === "w" ? "White" : "Black"}</span>
        </div>
        <div>
          You play:{" "}
          <span className="font-medium text-zinc-900">{state.playerSide === "white" ? "White" : "Black"}</span>
        </div>
        <div>
          Side:{" "}
          <select
            className="ml-2 h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
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

      <div className="mt-5 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-zinc-900">Opponent simulation</div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-900" htmlFor="sim-opp-username">
              Opponent (Lichess username)
            </label>
            <input
              id="sim-opp-username"
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              value={opponentUsername}
              onChange={(e) => setOpponentUsername(e.target.value)}
              placeholder="opponent_username"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-900" htmlFor="sim-opp-mode">
              Move selection
            </label>
            <select
              id="sim-opp-mode"
              className="h-11 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
            >
              <option value="proportional">Proportional (by frequency)</option>
              <option value="random">Random (uniform)</option>
            </select>
          </div>
        </div>

        <div className="grid gap-2 text-sm text-zinc-700">
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
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            disabled={simBusy || !opponentUsername.trim() || state.isGameOver}
            onClick={onOpponentMoveNow}
          >
            {simBusy ? "Thinking…" : "Opponent move now"}
          </button>
        </div>
      </div>

      {state.status ? <div className="mt-3 text-sm text-zinc-600">{state.status}</div> : null}
    </div>
  );
}
