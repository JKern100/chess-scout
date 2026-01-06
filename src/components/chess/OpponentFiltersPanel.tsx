"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { DateRangePresetSelect } from "./DateRangePresetSelect";
import type { DatePreset, OpponentRatedFilter, OpponentSpeed } from "./useOpponentFilters";

function StyleMarkersHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-zinc-900">ChessScout Style Markers</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>
        
        <div className="text-[13px] leading-relaxed space-y-4">
          <section>
            <h4 className="font-semibold text-zinc-800 mb-1">What are Style Markers?</h4>
            <p className="text-zinc-600">
              Style Markers are behavioral fingerprints computed from your opponent&apos;s historical games. 
              They quantify <strong>how</strong> someone plays—their tendencies, preferences, and patterns.
            </p>
          </section>

          <section>
            <h4 className="font-semibold text-zinc-800 mb-1">How are they calculated?</h4>
            <p className="text-zinc-600 mb-2">
              Each marker analyzes the opponent&apos;s games matching your current filters:
            </p>
            <ul className="text-zinc-600 text-[12px] space-y-1 list-disc list-inside">
              <li><strong>Queen Trades:</strong> % of games with both queens off by move 20</li>
              <li><strong>Aggression:</strong> Captures + checks in the first 15 moves</li>
              <li><strong>Game Length:</strong> Average game length in full moves</li>
              <li><strong>Opposite Castling:</strong> % of games with opposite-side castling</li>
              <li><strong>Castling Timing:</strong> Average ply when opponent castles</li>
            </ul>
          </section>

          <section>
            <h4 className="font-semibold text-zinc-800 mb-1">Opening & Color Context</h4>
            <p className="text-zinc-600">
              Style varies by opening type and color. Once generated, you can filter markers by:
            </p>
            <ul className="text-zinc-600 text-[12px] space-y-1 mt-2 list-disc list-inside">
              <li><strong>Open:</strong> 1.e4 e5 — tactical, open lines</li>
              <li><strong>Semi-Open:</strong> 1.e4 (c5, e6, etc.) — asymmetric tension</li>
              <li><strong>Closed:</strong> 1.d4 d5 — positional, slow builds</li>
              <li><strong>Indian:</strong> 1.d4 Nf6 — hypermodern systems</li>
              <li><strong>Flank:</strong> 1.c4, 1.Nf3, etc. — flexible setups</li>
            </ul>
          </section>

          <section>
            <h4 className="font-semibold text-zinc-800 mb-1">How Scout Uses Style Markers</h4>
            <p className="text-zinc-600">
              The Scout prediction engine (🧠) combines three factors:
            </p>
            <ul className="text-zinc-600 text-[12px] space-y-1 mt-2 list-disc list-inside">
              <li><strong>History (α):</strong> Moves the opponent has actually played here</li>
              <li><strong>Engine (β):</strong> Objectively best moves (Stockfish)</li>
              <li><strong>Style (γ):</strong> Moves fitting the opponent&apos;s behavioral profile</li>
            </ul>
            <p className="text-zinc-600 mt-2">
              Weights shift by phase: <strong>opening</strong> (history 70%), 
              <strong> middlegame</strong> (style 50%), <strong>endgame</strong> (engine 80%).
            </p>
          </section>

          <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
            <p className="text-[11px] text-amber-800 font-medium mb-1">⚠️ Performance Note</p>
            <p className="text-[11px] text-amber-700">
              Generating style markers requires processing game data and adds ~1-2s to filter changes. 
              Disable this option if you don&apos;t need behavioral analysis for move predictions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  speeds: OpponentSpeed[];
  setSpeeds: (next: OpponentSpeed[] | ((prev: OpponentSpeed[]) => OpponentSpeed[])) => void;
  rated: OpponentRatedFilter;
  setRated: (next: OpponentRatedFilter) => void;
  datePreset: DatePreset;
  setDatePreset: (next: DatePreset) => void;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  generateStyleMarkers?: boolean;
  setGenerateStyleMarkers?: (v: boolean) => void;
  headerLeft?: string;
  headerRight?: ReactNode;
  actions?: ReactNode;
  footerNote?: ReactNode;
};

export function OpponentFiltersPanel(props: Props) {
  const {
    speeds,
    setSpeeds,
    rated,
    setRated,
    datePreset,
    setDatePreset,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    generateStyleMarkers: generateStyleMarkersProp,
    setGenerateStyleMarkers: setGenerateStyleMarkersProp,
    headerLeft,
    headerRight,
    actions,
    footerNote,
  } = props;

  const [generateStyleMarkersLocal, setGenerateStyleMarkersLocal] = useState(true);
  const [styleMarkersHelpOpen, setStyleMarkersHelpOpen] = useState(false);
  const generateStyleMarkers = typeof generateStyleMarkersProp === "boolean" ? generateStyleMarkersProp : generateStyleMarkersLocal;
  const setGenerateStyleMarkers =
    typeof setGenerateStyleMarkersProp === "function" ? setGenerateStyleMarkersProp : setGenerateStyleMarkersLocal;

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-zinc-900">{headerLeft ?? "Filters"}</div>
            <div className="text-[10px] text-zinc-500">Tune the dataset used across Analysis & Scout.</div>
          </div>
          {headerRight ? <div className="min-w-0 flex-1">{headerRight}</div> : null}
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <div className="grid gap-2">
          <div className="text-[10px] font-medium text-zinc-900">Time Control</div>
          <div className="flex flex-wrap items-center gap-2">
            {(["bullet", "blitz", "rapid", "classical", "correspondence"] as const).map((s) => {
              const checked = speeds.includes(s);
              return (
                <label
                  key={s}
                  className={`inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    checked ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setSpeeds((prev) => {
                        if (on) return prev.includes(s) ? prev : [...prev, s];
                        return prev.filter((x) => x !== s);
                      });
                    }}
                    className="hidden"
                  />
                  {s}
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="text-[10px] font-medium text-zinc-900">Mode</div>
            <select
              id="opp-filter-rated"
              className="h-9 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[11px] text-zinc-900 outline-none focus:border-zinc-400"
              value={rated}
              onChange={(e) => setRated(e.target.value as any)}
            >
              <option value="any">All</option>
              <option value="rated">Rated</option>
              <option value="casual">Casual</option>
            </select>
          </div>

          <div className="text-[10px] font-medium text-zinc-900">Date Range</div>
          <DateRangePresetSelect value={datePreset} onChange={setDatePreset} />

          <div className="grid gap-2 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-zinc-900" htmlFor="opp-filter-from">
                From
              </label>
              <input
                id="opp-filter-from"
                type="date"
                className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[11px] text-zinc-900 outline-none focus:border-zinc-400"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium text-zinc-900" htmlFor="opp-filter-to">
                To
              </label>
              <input
                id="opp-filter-to"
                type="date"
                className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[11px] text-zinc-900 outline-none focus:border-zinc-400"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[10px] text-zinc-600"
          title="For performance reasons, analysis is limited to the 5,000 most recent games matching your filters. If you have more games in the selected range, older games will be excluded."
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-300 bg-white text-[9px] font-semibold text-zinc-500">
            i
          </span>
          <span>Analysis limited to 5,000 most recent games</span>
        </div>

        <div className="flex select-none items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
          <label className="flex min-w-0 cursor-pointer items-center gap-2" htmlFor="opp-filter-style-markers">
            <input
              id="opp-filter-style-markers"
              type="checkbox"
              checked={generateStyleMarkers}
              onChange={(e) => setGenerateStyleMarkers(e.target.checked)}
              className="h-4 w-4 accent-[#FFFF00]"
            />
            <span className="truncate text-[10px] font-medium text-zinc-900">Generate ChessScout Style Markers</span>
          </label>

          <button
            type="button"
            onClick={() => setStyleMarkersHelpOpen(true)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-[11px] font-semibold text-zinc-600 hover:bg-zinc-50"
            aria-label="Style markers help"
          >
            ?
          </button>
        </div>

        {actions ? <div className="pt-1">{actions}</div> : null}

        {footerNote ? <div className="text-[10px] text-zinc-600">{footerNote}</div> : null}
      </div>

      {styleMarkersHelpOpen && <StyleMarkersHelpModal onClose={() => setStyleMarkersHelpOpen(false)} />}
    </div>
  );
}
