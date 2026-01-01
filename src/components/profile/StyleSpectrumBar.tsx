"use client";

import { useMemo } from "react";

export type StyleSpectrumData = {
  /** Opponent's raw value (e.g., 0.66 for 66% queen trade rate) */
  opponentRaw: number;
  /** Benchmark raw value (e.g., 0.12 for 12% benchmark) */
  benchmarkRaw: number;
  /** Maximum value for scaling (e.g., 1.0 for percentages, 8.0 for aggression) */
  maxRaw: number;
  /** Category name for tooltip (e.g., "Open", "Indian") */
  category?: string;
  /** Sample size for tooltip */
  sampleSize?: number;
  /** Numerator for tooltip (e.g., games with queen trade) */
  numerator?: number;
  /** Alerts for this axis (e.g., color asymmetry warnings) */
  alerts?: Array<{ type: string; message: string; white_value: number; black_value: number }>;
  /** Current color filter being displayed */
  colorFilter?: "overall" | "white" | "black";
};

export function StyleSpectrumBar(props: {
  title: string;
  leftLabel: string;
  rightLabel: string;
  /** Position as 0-100 percentage (legacy mode) */
  positionPct?: number;
  /** Absolute data for new mode with benchmark tick + tooltip */
  data?: StyleSpectrumData;
  /** Unit label for tooltip (e.g., "%", " attacks/game") */
  unit?: string;
  /** Animate the dot position (legacy mode only) */
  animate?: boolean;
}) {
  const { data, unit = "%", animate } = props;

  // Calculate positions from absolute data or fall back to legacy positionPct
  const { opponentPct, benchmarkPct, tooltipText } = useMemo(() => {
    if (data) {
      const { opponentRaw, benchmarkRaw, maxRaw, category, sampleSize, numerator } = data;
      const max = maxRaw > 0 ? maxRaw : 1;
      
      // Convert raw values to 0-100% scale
      const oppPct = Math.max(0, Math.min(100, (opponentRaw / max) * 100));
      const benchPct = Math.max(0, Math.min(100, (benchmarkRaw / max) * 100));
      
      // Calculate ratio for tooltip
      const ratio = benchmarkRaw > 0 ? opponentRaw / benchmarkRaw : 0;
      const ratioStr = ratio > 0 ? `${ratio.toFixed(2)}x` : "—";
      
      // Format values for display
      const isPercent = unit === "%";
      const oppDisplay = isPercent ? `${(opponentRaw * 100).toFixed(1)}%` : `${opponentRaw.toFixed(1)}${unit}`;
      const benchDisplay = isPercent ? `${(benchmarkRaw * 100).toFixed(1)}%` : `${benchmarkRaw.toFixed(1)}${unit}`;
      
      // Build tooltip
      let tooltip = `${oppDisplay}`;
      if (numerator != null && sampleSize != null && sampleSize > 0) {
        tooltip += ` (${numerator}/${sampleSize})`;
      }
      tooltip += ` vs ${category ?? "Global"} benchmark ${benchDisplay}`;
      tooltip += ` (${ratioStr})`;
      
      return { opponentPct: oppPct, benchmarkPct: benchPct, tooltipText: tooltip };
    }
    
    // Legacy mode: use positionPct directly, benchmark at 50%
    const pos = Number(props.positionPct);
    const oppPct = Number.isFinite(pos) ? Math.max(0, Math.min(100, pos)) : 50;
    return { opponentPct: oppPct, benchmarkPct: 50, tooltipText: undefined };
  }, [data, props.positionPct, unit]);

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-neutral-800">{props.title}</div>
        {data && (
          <div className="text-[10px] font-medium text-neutral-600">
            {unit === "%" ? `${(data.opponentRaw * 100).toFixed(0)}%` : `${data.opponentRaw.toFixed(1)}${unit}`}
          </div>
        )}
      </div>
      <div className="relative h-6 group" title={tooltipText}>
        {/* Track */}
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-neutral-200" />

        {/* Benchmark tick */}
        <div
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-neutral-400"
          style={{ left: `${benchmarkPct}%` }}
        />
        
        {/* Benchmark label (shows on hover) */}
        <div
          className="absolute -top-4 -translate-x-1/2 text-[9px] text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${benchmarkPct}%` }}
        >
          {data?.category ?? "Avg"}
        </div>

        {/* Opponent dot */}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-500 shadow transition-[left] duration-200 ease-in-out"
          style={{ left: `${opponentPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-neutral-500">
        <div className="truncate">{props.leftLabel}</div>
        <div className="truncate text-right">{props.rightLabel}</div>
      </div>
    </div>
  );
}
