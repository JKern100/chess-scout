"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { DateRangePresetSelect } from "./DateRangePresetSelect";
import type { DatePreset, OpponentRatedFilter, OpponentSpeed } from "./useOpponentFilters";

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
  headerLeft?: string;
  headerRight?: ReactNode;
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
    headerLeft,
    headerRight,
    footerNote,
  } = props;

  const [generateStyleMarkers, setGenerateStyleMarkers] = useState(true);

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="grid gap-2">
        {headerLeft || headerRight ? (
          <div className="flex items-center justify-between gap-4">
            <div className="text-[10px] font-medium text-zinc-900">{headerLeft}</div>
            {headerRight ? <div>{headerRight}</div> : null}
          </div>
        ) : null}

        <div className="grid gap-2">
          <div className="text-[10px] font-medium text-zinc-900">Time Control</div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-700">
            {(["bullet", "blitz", "rapid", "classical", "correspondence"] as const).map((s) => {
              const checked = speeds.includes(s);
              return (
                <label key={s} className="inline-flex items-center gap-1.5">
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
                  />
                  {s}
                </label>
              );
            })}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-medium text-zinc-900">Mode</div>
              <select
                id="opp-filter-rated"
                className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
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
                  className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
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
                  className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>

            <label
              className="mt-1 inline-flex select-none items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2"
              htmlFor="opp-filter-style-markers"
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  id="opp-filter-style-markers"
                  type="checkbox"
                  checked={generateStyleMarkers}
                  onChange={(e) => setGenerateStyleMarkers(e.target.checked)}
                  className="h-4 w-4 accent-[#FFFF00]"
                />
                <span className="truncate text-[10px] font-medium text-zinc-900">Generate ChessScout Style Markers</span>
              </span>

              <span
                title="Used in move predictions"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-200 bg-white text-[10px] font-semibold text-zinc-600"
              >
                i
              </span>
            </label>
          </div>

          {footerNote ? <div className="text-[10px] text-zinc-600">{footerNote}</div> : null}
        </div>
      </div>
    </div>
  );
}
