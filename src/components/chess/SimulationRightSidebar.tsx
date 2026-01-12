"use client";

import { Filter, Settings, Brain, Search } from "lucide-react";
import type { ChessBoardCoreState } from "./ChessBoardCore";
import { ScoutPanelContent } from "./ScoutOverlay";

type Strategy = "proportional" | "random";

type TimeControlPreset = {
  key: string;
  label: string;
  baseMinutes: number;
  incrementSeconds: number;
  category: "bullet" | "blitz" | "rapid" | "classical";
};

type SimulationRightTab = "filters" | "settings" | "scout";

type Props = {
  state: ChessBoardCoreState;
  activeTab: SimulationRightTab;
  setActiveTab: (t: SimulationRightTab) => void;
  // Filters tab props
  filtersPanel: React.ReactNode;
  opponentPlaysColor: "white" | "black";
  setOpponentPlaysColor: (c: "white" | "black") => void;
  // Settings tab props
  mode: Strategy;
  setMode: (m: Strategy) => void;
  clocksEnabled: boolean;
  setClocksEnabled: (v: boolean) => void;
  timeControls: TimeControlPreset[];
  timeControlKey: string;
  setTimeControlKey: (k: string) => void;
  clockRunning: boolean;
  clockPaused: boolean;
  clockExpired: boolean;
  gameStarted: boolean;
  onStartGame: () => void;
  onClockPause: () => void;
  onClockResume: () => void;
  onClockStop: () => void;
  // Simulation status
  engineTakeover: boolean;
  scoutInsightTakeover: boolean;
  simWarmStatus: "idle" | "warming" | "warm" | "error";
  simWarmMeta: { status: string; buildMs: number; maxGames: number } | null;
  depthRemaining: number | null;
  lastOpponentMove: { uci: string; san: string | null } | null;
  opponentCommentary: string | null;
  simBusy: boolean;
  // Out of History options
  useScoutInsightsForOutOfHistory: boolean;
  setUseScoutInsightsForOutOfHistory: (v: boolean) => void;
  // Scout tab props
  scoutEnabled?: boolean;
  opponentUsername?: string;
  scoutPrediction?: any;
  scoutPredictionFen?: string | null;
  scoutLoading?: boolean;
  scoutError?: string | null;
  scoutMode?: "pure_history" | "hybrid";
  onScoutModeChange?: (mode: "pure_history" | "hybrid") => void;
  onScoutPredict?: () => void;
  scoutOpponentReplyByMove?: Record<string, any> | null;
  scoutOpponentReplyLoading?: boolean;
  onAnalyzeGame?: () => void;
};

export function SimulationRightSidebar(props: Props) {
  const {
    state,
    activeTab,
    setActiveTab,
    filtersPanel,
    opponentPlaysColor,
    setOpponentPlaysColor,
    mode,
    setMode,
    clocksEnabled,
    setClocksEnabled,
    timeControls,
    timeControlKey,
    setTimeControlKey,
    clockRunning,
    clockPaused,
    clockExpired,
    gameStarted,
    onStartGame,
    onClockPause,
    onClockResume,
    onClockStop,
    engineTakeover,
    scoutInsightTakeover,
    simWarmStatus,
    simWarmMeta,
    depthRemaining,
    lastOpponentMove,
    opponentCommentary,
    simBusy,
    useScoutInsightsForOutOfHistory,
    setUseScoutInsightsForOutOfHistory,
    scoutEnabled = false,
    opponentUsername = "",
    scoutPrediction,
    scoutPredictionFen,
    scoutLoading,
    scoutError,
    scoutMode,
    onScoutModeChange,
    onScoutPredict,
    scoutOpponentReplyByMove,
    scoutOpponentReplyLoading,
    onAnalyzeGame,
  } = props;

  const turn = state.game.turn();
  const isPlayersTurn =
    (state.playerSide === "white" && turn === "w") || (state.playerSide === "black" && turn === "b");
  const isOpponentsTurn = !isPlayersTurn;
  const opponentIsWhite = state.playerSide === "black";

  // Play button is enabled when:
  // - Opponent is white AND game hasn't started yet (to start the game)
  // - OR clocks are enabled AND game is paused (to resume)
  // - NOT when opponent is black (game starts on user's first move)
  const canPlay = !clockExpired && (
    (!gameStarted && opponentIsWhite) || // Start game when opponent is white
    (clocksEnabled && clockPaused) // Resume from pause
  );
  const canPause = clocksEnabled && clockRunning && !clockPaused && !clockExpired && gameStarted;
  const canStop = clocksEnabled && gameStarted;

  return (
    <div className="grid gap-3">
      {/* Game Controls Card - Always visible */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-medium text-zinc-900">
            {!gameStarted
              ? opponentIsWhite
                ? "Press Play to start"
                : "Make your move to start"
              : clockExpired
                ? "Time expired"
                : clockPaused
                  ? "Game paused"
                  : "Game in progress"}
          </div>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                canPlay ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-zinc-200 text-white/60"
              }`}
              disabled={!canPlay}
              onClick={onStartGame}
              aria-label="Start/Resume game"
              title={gameStarted ? "Resume" : "Start Game"}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                canPause ? "bg-zinc-900 text-white" : "bg-zinc-200 text-white/60"
              }`}
              disabled={!canPause}
              onClick={onClockPause}
              aria-label="Pause clocks"
              title="Pause"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            </button>
            <button
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                canStop ? "bg-zinc-900 text-white" : "bg-zinc-200 text-white/60"
              }`}
              disabled={!canStop}
              onClick={onClockStop}
              aria-label="Reset game"
              title="Reset"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Tabbed Panel Card */}
      <div className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex min-w-0 items-center justify-between border-b border-zinc-200 px-2 py-2">
          <button
            type="button"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
              activeTab === "filters" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
            }`}
            title="Filters"
            onClick={() => setActiveTab("filters")}
          >
            <Filter className="h-5 w-5" />
          </button>
          <button
            type="button"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
              activeTab === "settings" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
            }`}
            title="Game Settings"
            onClick={() => setActiveTab("settings")}
          >
            <Settings className="h-5 w-5" />
          </button>
          {/* Scout Brain Tab Button */}
          {scoutEnabled ? (
            <button
              type="button"
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-50 ${
                activeTab === "scout" ? "bg-zinc-100 text-zinc-900" : "text-zinc-600"
              }`}
              title="Scout Insights"
              onClick={() => {
                setActiveTab("scout");
                if (onScoutPredict) onScoutPredict();
              }}
            >
              <Brain className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        <div className="min-w-0 overflow-auto p-3">
          {activeTab === "filters" ? (
          <div className="grid gap-4">
            {/* Opponent Plays Toggle */}
            <div className="grid gap-2">
              <div className="text-[10px] font-medium text-zinc-900">Opponent Plays</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[10px] font-medium transition-colors ${
                    opponentPlaysColor === "white"
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  onClick={() => setOpponentPlaysColor("white")}
                >
                  ♔ White
                </button>
                <button
                  type="button"
                  className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg text-[10px] font-medium transition-colors ${
                    opponentPlaysColor === "black"
                      ? "bg-zinc-900 text-white"
                      : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                  onClick={() => setOpponentPlaysColor("black")}
                >
                  ♚ Black
                </button>
              </div>
              <div className="text-[9px] text-zinc-500">
                You play as {opponentPlaysColor === "white" ? "Black" : "White"}
              </div>
            </div>

            {/* Existing filters panel */}
            {filtersPanel}
          </div>
        ) : activeTab === "settings" ? (
          <div className="grid gap-4">
            {/* Clocks Section */}
            <div className="grid gap-2">
              <div className="text-[10px] font-medium text-zinc-900">Clocks</div>
              <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={clocksEnabled}
                  onChange={(e) => setClocksEnabled(e.target.checked)}
                />
                Enable clocks
              </label>

              {clocksEnabled ? (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">Time Control</span>
                    <select
                      className="h-8 flex-1 rounded-xl border border-zinc-200 bg-white px-2 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
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
                  </div>

                </div>
              ) : null}
            </div>

            {/* Move Selection Logic Section */}
            <div className="grid gap-2">
              <div className="text-[10px] font-medium text-zinc-900">Move Selection Logic</div>
              
              {/* History-based moves */}
              <div className="grid gap-1">
                <div className="text-[9px] font-medium text-zinc-600 uppercase tracking-wide">From History</div>
                <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
                  <input
                    type="radio"
                    name="moveSelection"
                    checked={mode === "proportional"}
                    onChange={() => setMode("proportional")}
                  />
                  <span>
                    <span className="font-medium">Proportional (Realistic)</span>
                    <span className="block text-[9px] text-zinc-500">
                      Moves selected based on frequency in opponent's database
                    </span>
                  </span>
                </label>
                <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
                  <input
                    type="radio"
                    name="moveSelection"
                    checked={mode === "random"}
                    onChange={() => setMode("random")}
                  />
                  <span>
                    <span className="font-medium">Random</span>
                    <span className="block text-[9px] text-zinc-500">
                      Any candidate move has equal chance
                    </span>
                  </span>
                </label>
              </div>

              {/* Out of History fallback */}
              <div className="grid gap-1 pt-2 border-t border-zinc-200">
                <div className="text-[9px] font-medium text-zinc-600 uppercase tracking-wide">When Out of History</div>
                <label className="inline-flex items-center gap-2 text-[10px] text-zinc-700">
                  <input
                    type="checkbox"
                    checked={useScoutInsightsForOutOfHistory}
                    onChange={(e) => setUseScoutInsightsForOutOfHistory(e.target.checked)}
                  />
                  <span className="flex items-center gap-1">
                    <Brain className="h-3 w-3 text-purple-600" />
                    <span>
                      <span className="font-medium">Scout Insights</span>
                      <span className="block text-[9px] text-zinc-500">
                        AI-powered move prediction based on opponent's style
                      </span>
                    </span>
                  </span>
                </label>
                <div className="text-[9px] text-zinc-500 pl-5">
                  Falls back to engine if Scout unavailable
                </div>
              </div>
            </div>

            {/* Simulation Status Section */}
            <div className="grid gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
              <div className="text-[10px] font-medium text-zinc-900">Simulation Status</div>

              {scoutInsightTakeover ? (
                <div className="flex items-center gap-1 text-[10px] font-medium text-purple-700">
                  <Brain className="h-3 w-3" />
                  Out of opponent history — Scout Insights is predicting moves.
                </div>
              ) : engineTakeover ? (
                <div className="text-[10px] font-medium text-amber-700">
                  Out of opponent history — engine is now playing for the opponent.
                </div>
              ) : null}

              <div className="grid gap-1 text-[10px] text-zinc-700">
                <div className="flex items-center justify-between">
                  <span>
                    {simWarmStatus === "warming" ? "Staging games..." : "Staging"}
                    {simWarmStatus === "warm" ? " (ready)" : simWarmStatus === "error" ? " (error)" : ""}
                  </span>
                  <span className="text-zinc-500">
                    {simWarmStatus === "warming"
                      ? "working…"
                      : simWarmStatus === "warm"
                        ? "complete"
                        : simWarmStatus === "error"
                          ? "failed"
                          : "—"}
                  </span>
                </div>

                {simWarmStatus === "warm" && simWarmMeta ? (
                  <div className="text-[9px] text-zinc-500">
                    {simWarmMeta.maxGames} games staged ({Math.round(simWarmMeta.buildMs)}ms)
                  </div>
                ) : null}

                <div>
                  Depth remaining:{" "}
                  <span className="font-medium text-zinc-900">
                    {depthRemaining == null ? "—" : String(depthRemaining)}
                  </span>
                </div>

                <div>
                  Last opponent move:{" "}
                  <span className="font-medium text-zinc-900">
                    {lastOpponentMove ? `${lastOpponentMove.san ?? lastOpponentMove.uci}` : "—"}
                  </span>
                </div>

                {opponentCommentary ? (
                  <div className="text-zinc-600">{opponentCommentary}</div>
                ) : null}

                <div className="text-zinc-500">
                  {state.isGameOver
                    ? "Game over"
                    : simBusy
                      ? "Opponent thinking…"
                      : isOpponentsTurn
                        ? "Opponent to move"
                        : "Your move"}
                </div>

                {state.isGameOver && onAnalyzeGame ? (
                  <button
                    type="button"
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 px-3 py-2 text-[10px] font-medium text-white hover:bg-zinc-800"
                    onClick={onAnalyzeGame}
                  >
                    <Search className="h-3.5 w-3.5" />
                    Analyze this game
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Scout Tab Content */}
        {activeTab === "scout" ? (
          <ScoutPanelContent
            prediction={scoutPrediction}
            loading={scoutLoading}
            error={scoutError}
            mode={scoutMode}
            onModeChange={onScoutModeChange}
            opponentUsername={opponentUsername}
            opponentReplyByMove={scoutOpponentReplyByMove}
            opponentReplyLoading={scoutOpponentReplyLoading}
            onRefresh={onScoutPredict}
            isOpponentTurn={isOpponentsTurn}
            currentFen={state.fen}
            predictionFen={scoutPredictionFen}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}
