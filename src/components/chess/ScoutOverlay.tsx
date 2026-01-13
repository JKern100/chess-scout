"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { Brain, X, AlertTriangle, Zap, Target, TrendingUp, HelpCircle, Info } from "lucide-react";

export type PredictionMode = "pure_history" | "hybrid";

export type StyleMarkers = {
  aggression_index: number;
  queen_trade_avoidance: number;
  material_greed: number;
  complexity_preference: number;
  space_expansion: number;
  blunder_rate: number;
  time_pressure_weakness: number;
};

export type MoveAttribution = {
  aggression_bonus: number;
  complexity_bonus: number;
  trade_penalty: number;
  greed_bonus: number;
  space_bonus: number;
  tilt_modifier: number;
};

export type CandidateMove = {
  move: string;
  move_uci: string;
  engine_eval: number;
  engine_rank: number;
  history_frequency: number;
  style_fit: number;
  raw_score: number;
  final_prob: number;
  attribution: MoveAttribution;
  reason: string;
};

export type PhaseWeights = {
  phase: string;
  history: number;
  engine: number;
  style: number;
  predictability_index?: number;
  sample_size?: number;
  weight_mode?: string;
};

export type HabitDetection = {
  detected: boolean;
  move?: string;
  frequency?: number;
  sample_size?: number;
};

export type MoveSourceAttribution = {
  primary_source: "history" | "style" | "engine";
  history_contribution: number;
  style_contribution: number;
  engine_contribution: number;
};

export type TraceLogEntry = {
  type: "logic" | "warning" | "decision" | "tilt";
  message: string;
};

export type TacticalGuardrail = {
  triggered: boolean;
  eval_delta: number;
  is_forcing: boolean;
  reason: string;
};

export type ScoutPrediction = {
  prediction_mode: PredictionMode;
  selected_move: string;
  selected_move_uci: string;
  weights: PhaseWeights;
  candidates: CandidateMove[];
  trace_log: TraceLogEntry[];
  tilt_active: boolean;
  blunder_applied: boolean;
  habit_detection?: HabitDetection;
  move_source?: MoveSourceAttribution;
  suggested_delay_ms?: number;
  tactical_guardrail?: TacticalGuardrail;
};

export type OpponentReplyForecast = {
  reply_move: string;
  reply_prob?: number;
  reply_reason?: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  prediction: ScoutPrediction | null;
  loading: boolean;
  mode: PredictionMode;
  onModeChange: (mode: PredictionMode) => void;
  opponentUsername: string;
  opponentReplyByMove?: Record<string, OpponentReplyForecast> | null;
  opponentReplyLoading?: boolean;
  error?: string | null;
};

const AttributionPieChart = memo(function AttributionPieChart({
  weights,
}: {
  weights: PhaseWeights;
}) {
  const total = weights.history + weights.engine + weights.style;
  const historyPct = (weights.history / total) * 100;
  const enginePct = (weights.engine / total) * 100;
  const stylePct = (weights.style / total) * 100;

  // Calculate stroke-dasharray for each segment
  const circumference = 2 * Math.PI * 40;
  const historyDash = (historyPct / 100) * circumference;
  const engineDash = (enginePct / 100) * circumference;
  const styleDash = (stylePct / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#3b82f6"
          strokeWidth="12"
          strokeDasharray={`${historyDash} ${circumference}`}
          strokeDashoffset="0"
          transform="rotate(-90 50 50)"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#10b981"
          strokeWidth="12"
          strokeDasharray={`${engineDash} ${circumference}`}
          strokeDashoffset={-historyDash}
          transform="rotate(-90 50 50)"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="12"
          strokeDasharray={`${styleDash} ${circumference}`}
          strokeDashoffset={-(historyDash + engineDash)}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="middle" className="text-xs font-semibold fill-zinc-700">
          {weights.phase}
        </text>
      </svg>
      <div className="grid gap-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-blue-500" />
          <span className="text-zinc-600">History</span>
          <span className="font-semibold text-zinc-900">{Math.round(historyPct)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-emerald-500" />
          <span className="text-zinc-600">Engine</span>
          <span className="font-semibold text-zinc-900">{Math.round(enginePct)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-amber-500" />
          <span className="text-zinc-600">Style</span>
          <span className="font-semibold text-zinc-900">{Math.round(stylePct)}%</span>
        </div>
      </div>
    </div>
  );
});

// Prediction Triad - 3-vertex radar chart showing weight distribution
const PredictionTriad = memo(function PredictionTriad({
  weights,
  pulseColor,
}: {
  weights: PhaseWeights;
  pulseColor?: "blue" | "purple" | "green";
}) {
  const total = weights.history + weights.engine + weights.style;
  const historyNorm = weights.history / total;
  const engineNorm = weights.engine / total;
  const styleNorm = weights.style / total;
  
  // Triangle vertices (equilateral, pointing up)
  const cx = 50, cy = 50, r = 35;
  const vertices = [
    { x: cx, y: cy - r, label: "Habit", value: historyNorm }, // Top
    { x: cx + r * Math.cos(Math.PI / 6), y: cy + r * Math.sin(Math.PI / 6), label: "Engine", value: engineNorm }, // Bottom right
    { x: cx - r * Math.cos(Math.PI / 6), y: cy + r * Math.sin(Math.PI / 6), label: "Style", value: styleNorm }, // Bottom left
  ];
  
  // Calculate center point based on weights
  const centerX = cx + (engineNorm - styleNorm) * r * 0.8;
  const centerY = cy + (1 - historyNorm) * r * 0.6 - r * 0.2;
  
  const pulseClass = pulseColor === "blue" ? "fill-blue-500" : 
                     pulseColor === "purple" ? "fill-purple-500" : 
                     pulseColor === "green" ? "fill-emerald-500" : "fill-amber-500";

  return (
    <div className="flex items-center gap-2">
      <svg width="80" height="80" viewBox="0 0 100 100">
        {/* Triangle outline */}
        <polygon
          points={vertices.map(v => `${v.x},${v.y}`).join(" ")}
          fill="none"
          stroke="#e4e4e7"
          strokeWidth="1"
        />
        {/* Vertex labels */}
        {vertices.map((v, i) => (
          <text
            key={i}
            x={v.x}
            y={i === 0 ? v.y - 6 : v.y + 12}
            textAnchor="middle"
            className="fill-zinc-500 text-[8px]"
          >
            {v.label}
          </text>
        ))}
        {/* Center point */}
        <circle
          cx={centerX}
          cy={centerY}
          r="6"
          className={`${pulseClass} ${pulseColor ? "animate-pulse" : ""}`}
        />
      </svg>
    </div>
  );
});

// Help Modal with comprehensive documentation
const ScoutHelpModal = memo(function ScoutHelpModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-900">Scout Move Prediction System</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-zinc-100">
            <X className="h-5 w-5 text-zinc-500" />
          </button>
        </div>
        
        <div className="prose prose-sm max-w-none text-zinc-700">
          <h3 className="text-base font-semibold text-zinc-800">How Move Prediction Works</h3>
          <p>
            ChessScout predicts your opponent&apos;s most likely moves using a sophisticated algorithm that combines
            three key factors: <strong>Historical Habits</strong>, <strong>Style Alignment</strong>, and <strong>Engine Strength</strong>.
          </p>

          <p className="text-xs">
            When it&apos;s <strong>not</strong> the opponent&apos;s turn, Scout switches into a planning mode: <strong>Style is disabled</strong>
            (W<sub>s</sub>=0) and only History vs Engine are used.
          </p>
          
          <h4 className="mt-4 text-sm font-semibold text-zinc-800">The Probability Formula</h4>
          <div className="my-2 rounded-lg bg-zinc-100 p-3 font-mono text-xs">
            P(m) = (W<sub>h</sub> × H<sub>m</sub>) + (W<sub>s</sub> × S<sub>m</sub>) + (W<sub>e</sub> × E<sub>m</sub>)
          </div>
          <ul className="mt-2 text-xs">
            <li><strong>H<sub>m</sub> (Historical Frequency)</strong>: How often the player chose this move in this exact position</li>
            <li><strong>S<sub>m</sub> (Style Alignment)</strong>: How well the move fits the player&apos;s style markers (aggression, complexity preference, etc.)</li>
            <li><strong>E<sub>m</sub> (Engine Strength)</strong>: The move&apos;s quality based on Stockfish evaluation</li>
          </ul>
          
          <h4 className="mt-4 text-sm font-semibold text-zinc-800">Dynamic Weight Modes</h4>
          <p className="text-xs">
            The weights (W<sub>h</sub>, W<sub>s</sub>, W<sub>e</sub>) automatically adjust based on how predictable the player is:
          </p>

          <div className="mt-2 grid gap-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">Planning</span>
                <span className="text-xs text-emerald-800">Not opponent&apos;s turn</span>
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                Style disabled. Opening: W<sub>h</sub>=0.8, W<sub>e</sub>=0.2. Middlegame/Endgame: W<sub>h</sub>=0.3, W<sub>e</sub>=0.7.
              </p>
            </div>
          </div>
          
          <div className="mt-2 grid gap-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-bold text-white">95% Move</span>
                <span className="text-xs text-blue-800">PI &gt; 0.85</span>
              </div>
              <p className="mt-1 text-xs text-blue-700">
                High predictability. History dominates (90%). The AI plays the habit even if it&apos;s an engine blunder.
              </p>
            </div>
            
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-purple-500 px-2 py-0.5 text-[10px] font-bold text-white">Chameleon</span>
                <span className="text-xs text-purple-800">PI &lt; 0.40</span>
              </div>
              <p className="mt-1 text-xs text-purple-700">
                Low predictability. Style dominates (60%). The AI predicts based on what this type of player usually likes.
              </p>
            </div>
            
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-zinc-500 px-2 py-0.5 text-[10px] font-bold text-white">Low Sample</span>
                <span className="text-xs text-zinc-600">N &lt; 5 games</span>
              </div>
              <p className="mt-1 text-xs text-zinc-600">
                Not enough data. History is ignored. Style (70%) and Engine (30%) are used instead.
              </p>
            </div>
          </div>
          
          <h4 className="mt-4 text-sm font-semibold text-zinc-800">Predictability Index (PI)</h4>
          <div className="my-2 rounded-lg bg-zinc-100 p-3 font-mono text-xs">
            PI = Σ(p<sub>i</sub>²)
          </div>
          <p className="text-xs">
            PI measures how concentrated the player&apos;s choices are. A PI of 1.0 means they always play the same move.
            A PI close to 0 means they vary their play significantly.
          </p>
          
          <h4 className="mt-4 text-sm font-semibold text-zinc-800">Visual Indicators</h4>
          <ul className="text-xs">
            <li><strong className="text-orange-600">HABIT DETECTED Banner</strong>: Appears when a player plays one move 90%+ of the time (with N&gt;10 games)</li>
            <li><strong className="text-blue-600">Blue Aura</strong>: Move predicted primarily by History</li>
            <li><strong className="text-purple-600">Purple Aura</strong>: Move predicted primarily by Style</li>
            <li><strong className="text-emerald-600">Green Aura</strong>: Move predicted primarily by Engine</li>
          </ul>
          
          <h4 className="mt-4 text-sm font-semibold text-zinc-800">Simulation Behavior</h4>
          <p className="text-xs">
            In Shadow Boxer mode, habit moves (W<sub>h</sub> &gt; 0.8) are played instantly (0.5s) to mimic &quot;opening book&quot; speed.
            If the 95% move is a blunder, the AI will still play it—allowing you to practice the refutation.
          </p>
        </div>
        
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-lg bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Got it
        </button>
      </div>
    </div>
  );
});

const CandidateRow = memo(function CandidateRow({
  candidate,
  isSelected,
}: {
  candidate: CandidateMove;
  isSelected: boolean;
}) {
  const hasBonus = candidate.attribution.aggression_bonus > 0 ||
    candidate.attribution.complexity_bonus > 0 ||
    candidate.attribution.greed_bonus > 0 ||
    candidate.attribution.space_bonus > 0;
  const hasPenalty = candidate.attribution.trade_penalty < 0;

  return (
    <div
      className={`grid grid-cols-[60px_60px_64px_60px_1fr] items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelected ? "bg-amber-50 ring-1 ring-amber-300" : "bg-zinc-50"
      }`}
    >
      <div className="font-semibold text-zinc-900">{candidate.move}</div>
      <div className="text-zinc-600">{candidate.final_prob.toFixed(1)}%</div>
      <div className="font-mono text-[12px] text-zinc-600">
        {typeof candidate.engine_eval === "number"
          ? `${candidate.engine_eval >= 0 ? "+" : ""}${candidate.engine_eval.toFixed(2)}`
          : "—"}
      </div>
      <div className="flex items-center gap-1">
        {hasBonus && <TrendingUp className="h-3 w-3 text-emerald-500" />}
        {hasPenalty && <AlertTriangle className="h-3 w-3 text-rose-500" />}
        <span className="text-zinc-500">#{candidate.engine_rank}</span>
      </div>
      <div className="truncate text-xs text-zinc-500">{candidate.reason}</div>
    </div>
  );
});

const TraceLog = memo(function TraceLog({
  entries,
}: {
  entries: TraceLogEntry[];
}) {
  return (
    <div className="h-48 overflow-y-auto rounded-lg bg-zinc-900 p-3 font-mono text-xs">
      {entries.map((entry, i) => {
        let color = "text-zinc-400";
        let prefix = "[LOG]";
        if (entry.type === "warning") {
          color = "text-amber-400";
          prefix = "[WARN]";
        } else if (entry.type === "decision") {
          color = "text-emerald-400";
          prefix = "[DECISION]";
        } else if (entry.type === "tilt") {
          color = "text-rose-400";
          prefix = "[TILT]";
        } else if (entry.type === "logic") {
          color = "text-blue-400";
          prefix = "[LOGIC]";
        }

        return (
          <div key={i} className={`${color} leading-relaxed`}>
            <span className="opacity-60">{prefix}</span> {entry.message}
          </div>
        );
      })}
      {entries.length === 0 && (
        <div className="text-zinc-500">Awaiting prediction...</div>
      )}
    </div>
  );
});

// Compact inline panel version for sidebar tabs
export const ScoutPanelContent = memo(function ScoutPanelContent({
  prediction,
  loading,
  error,
  mode,
  onModeChange,
  opponentUsername,
  opponentReplyByMove,
  opponentReplyLoading,
  onRefresh,
  isOpponentTurn = true,
  currentFen,
  predictionFen,
  playedMove,
  totalGamesInFilter,
  filtersLimited,
}: {
  prediction: ScoutPrediction | null;
  loading?: boolean;
  error?: string | null;
  mode?: PredictionMode;
  onModeChange?: (mode: PredictionMode) => void;
  opponentUsername: string;
  opponentReplyByMove?: Record<string, OpponentReplyForecast> | null;
  opponentReplyLoading?: boolean;
  onRefresh?: () => void;
  isOpponentTurn?: boolean;
  currentFen?: string;
  predictionFen?: string | null;
  playedMove?: { fen: string; uci: string; san: string | null } | null;
  totalGamesInFilter?: number;
  filtersLimited?: boolean;
}) {
  const LOW_SAMPLE_THRESHOLD = 100;
  const [helpOpen, setHelpOpen] = useState(false);
  const isShowingCurrent = Boolean(
    isOpponentTurn &&
      typeof currentFen === "string" &&
      typeof predictionFen === "string" &&
      currentFen.trim() === predictionFen.trim()
  );
  const title = isShowingCurrent ? "Opponent's Next Move" : "Opponent's Previous Move";

  const selectedMoveOverride =
    prediction &&
    playedMove &&
    typeof predictionFen === "string" &&
    playedMove.fen.trim() === predictionFen.trim()
      ? (playedMove.san ?? playedMove.uci)
      : null;

  const selectedMoveForDisplay = selectedMoveOverride ?? prediction?.selected_move ?? "";
  
  return (
    <div className="grid gap-3">
      {/* Help Modal */}
      <ScoutHelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-zinc-900">
            {title}
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            title="How prediction works"
          >
            <HelpCircle className="h-3 w-3" />
          </button>
        </div>
        {onRefresh && (
          <button
            type="button"
            className="inline-flex h-6 items-center justify-center rounded-lg px-2 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        )}
      </div>

      {/* Mode Toggle */}
      {mode && onModeChange && (
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
          <button
            type="button"
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              mode === "pure_history"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
            onClick={() => onModeChange("pure_history")}
          >
            History Only
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              mode === "hybrid"
                ? "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
            onClick={() => onModeChange("hybrid")}
          >
            Full Scout
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-[10px] font-medium text-red-700">Error</div>
          <div className="mt-1 text-[10px] text-red-600">{error}</div>
        </div>
      ) : prediction ? (
        <div className="grid gap-3">
          {/* Low Sample / Filter Warning */}
          {(totalGamesInFilter != null && totalGamesInFilter > 0 && totalGamesInFilter < LOW_SAMPLE_THRESHOLD) && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <div className="text-[9px] text-amber-700">
                <span className="font-semibold">Low confidence:</span> Only {totalGamesInFilter} games match your filter. Style predictions may be less accurate.
              </div>
            </div>
          )}
          {filtersLimited && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0" />
              <div className="text-[9px] text-blue-700">
                Date filters use all available game data. Speed/rated filters are applied.
              </div>
            </div>
          )}

          {/* Habit Detection Banner - Only show for opponent's turn */}
          {prediction.habit_detection?.detected && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-white">
                <Brain className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1">
                <div className="text-[10px] font-semibold text-orange-800">
                  HABIT DETECTED
                </div>
                <div className="text-[9px] text-orange-700">
                  Player plays <span className="font-bold">{prediction.habit_detection.move}</span> {prediction.habit_detection.frequency?.toFixed(0)}% of the time (N={prediction.habit_detection.sample_size})
                </div>
              </div>
            </div>
          )}

          {/* Status Indicators */}
          <div className="flex flex-wrap items-center gap-2">
            {prediction.tactical_guardrail?.triggered && (
              <div className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-700">
                <Target className="h-2.5 w-2.5" />
                Tactical Truth Prioritized
              </div>
            )}
            {prediction.tilt_active && (
              <div className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-medium text-rose-700">
                <Zap className="h-2.5 w-2.5" />
                Tilt
              </div>
            )}
            {prediction.blunder_applied && (
              <div className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium text-amber-700">
                <AlertTriangle className="h-2.5 w-2.5" />
                Blunder
              </div>
            )}
            {/* Weight Mode Indicator */}
            {prediction.weights.weight_mode && prediction.weights.weight_mode !== "phase" && (
              <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${
                prediction.weights.weight_mode === "habit" ? "bg-blue-100 text-blue-700" :
                prediction.weights.weight_mode === "chameleon" ? "bg-purple-100 text-purple-700" :
                "bg-zinc-100 text-zinc-700"
              }`}>
                {prediction.weights.weight_mode === "habit" ? "95% Move" :
                 prediction.weights.weight_mode === "chameleon" ? "Chameleon" :
                 prediction.weights.weight_mode === "low_sample" ? "Low Sample" : prediction.weights.weight_mode}
              </div>
            )}
            <div className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-medium text-zinc-700">
              <Target className="h-2.5 w-2.5" />
              {selectedMoveForDisplay}
            </div>
          </div>

          {/* Weight Distribution - Compact */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
            <div className="mb-2 text-[9px] font-medium text-zinc-700">Weight Distribution ({prediction.weights.phase})</div>
            <div className="flex items-center gap-3 text-[9px]">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-blue-500" />
                <span className="text-zinc-600">History {Math.round((prediction.weights.history / (prediction.weights.history + prediction.weights.engine + prediction.weights.style)) * 100)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                <span className="text-zinc-600">Engine {Math.round((prediction.weights.engine / (prediction.weights.history + prediction.weights.engine + prediction.weights.style)) * 100)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-amber-500" />
                <span className="text-zinc-600">Style {Math.round((prediction.weights.style / (prediction.weights.history + prediction.weights.engine + prediction.weights.style)) * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Candidate Moves - Compact */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
            <div className="mb-2 text-[9px] font-medium text-zinc-700">Top Candidates</div>
            <div className="grid gap-1">
              {prediction.candidates.slice(0, 5).map((c) => (
                <div
                  key={c.move}
                  className={`flex items-center justify-between rounded-lg px-2 py-1 text-[10px] ${
                    c.move === selectedMoveForDisplay ? "bg-amber-50 ring-1 ring-amber-200" : "bg-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-900">{c.move}</span>
                    <span className="text-zinc-500">#{c.engine_rank}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-zinc-500">
                      {typeof c.engine_eval === "number"
                        ? `${c.engine_eval >= 0 ? "+" : ""}${c.engine_eval.toFixed(2)}`
                        : ""}
                    </span>
                    <span className="font-medium text-zinc-700">{c.final_prob.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trace Log - Compact */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-900 p-2">
            <div className="mb-1 text-[9px] font-medium text-zinc-400">Logic Trace</div>
            <div className="max-h-24 overflow-y-auto font-mono text-[9px] leading-relaxed">
              {prediction.trace_log.slice(0, 6).map((entry, i) => {
                let color = "text-zinc-500";
                if (entry.type === "warning") color = "text-amber-400";
                else if (entry.type === "decision") color = "text-emerald-400";
                else if (entry.type === "tilt") color = "text-rose-400";
                else if (entry.type === "logic") color = "text-blue-400";
                return (
                  <div key={i} className={`${color} truncate`}>
                    {entry.message}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center text-[10px] text-zinc-500">
          Click refresh to load Scout prediction
        </div>
      )}
    </div>
  );
});

export const ScoutOverlay = memo(function ScoutOverlay({
  isOpen,
  onClose,
  prediction,
  loading,
  mode,
  onModeChange,
  opponentUsername,
  opponentReplyByMove,
  opponentReplyLoading,
  error,
}: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/20 bg-white/90 p-6 shadow-2xl backdrop-blur-md">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Scout Insights</h2>
              <p className="text-xs text-zinc-500">Analyzing {opponentUsername}'s style</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === "pure_history"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
                onClick={() => onModeChange("pure_history")}
              >
                History Only
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode === "hybrid"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
                onClick={() => onModeChange("hybrid")}
              >
                Full Scout
              </button>
            </div>
            <button
              type="button"
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center">
            <div className="text-center">
              <div className="text-red-500 mb-2">Error: {error}</div>
              <div className="text-zinc-500 text-sm">Please check if Scout API is running</div>
            </div>
          </div>
        ) : prediction ? (
          <div className="mt-4 grid gap-6">
            {/* Status Indicators */}
            <div className="flex items-center gap-4">
              {prediction.tactical_guardrail?.triggered && (
                <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                  <Target className="h-3 w-3" />
                  Tactical Truth Prioritized
                </div>
              )}
              {prediction.tilt_active && (
                <div className="flex items-center gap-2 rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">
                  <Zap className="h-3 w-3" />
                  Tilt Detected
                </div>
              )}
              {prediction.blunder_applied && (
                <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                  <AlertTriangle className="h-3 w-3" />
                  Blunder Simulated
                </div>
              )}
              <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700">
                <Target className="h-3 w-3" />
                Selected: {prediction.selected_move}
              </div>
            </div>

            {/* Attribution Chart */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">Weight Distribution</h3>
              <AttributionPieChart weights={prediction.weights} />
            </div>

            {/* Candidate Moves */}
            <div className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">Candidate Moves</h3>
              <div className="grid gap-2">
                {prediction.candidates.slice(0, 5).map((c) => (
                  <div key={c.move} className="grid gap-1">
                    <CandidateRow candidate={c} isSelected={c.move === prediction.selected_move} />
                    {opponentReplyLoading ? (
                      <div className="px-3 text-[11px] text-zinc-500">Forecasting opponent reply…</div>
                    ) : opponentReplyByMove && opponentReplyByMove[c.move] ? (
                      <div className="px-3 text-[11px] text-zinc-500">
                        Likely reply: <span className="font-medium text-zinc-700">{opponentReplyByMove[c.move]!.reply_move}</span>
                        {typeof opponentReplyByMove[c.move]!.reply_prob === "number" ? (
                          <span className="text-zinc-400"> ({opponentReplyByMove[c.move]!.reply_prob!.toFixed(1)}%)</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Trace Log */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Logic Trace</h3>
              <TraceLog entries={prediction.trace_log} />
            </div>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center text-zinc-500">
            No prediction data available
          </div>
        )}
      </div>
    </div>
  );
});

export default ScoutOverlay;
