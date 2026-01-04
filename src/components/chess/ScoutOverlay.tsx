"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { Brain, X, AlertTriangle, Zap, Target, TrendingUp } from "lucide-react";

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
};

export type TraceLogEntry = {
  type: "logic" | "warning" | "decision" | "tilt";
  message: string;
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
      className={`grid grid-cols-[60px_60px_60px_1fr] items-center gap-2 rounded-lg px-3 py-2 text-sm ${
        isSelected ? "bg-amber-50 ring-1 ring-amber-300" : "bg-zinc-50"
      }`}
    >
      <div className="font-semibold text-zinc-900">{candidate.move}</div>
      <div className="text-zinc-600">{candidate.final_prob.toFixed(1)}%</div>
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
