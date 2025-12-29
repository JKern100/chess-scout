"use client";

import type { DatePreset } from "./useOpponentFilters";

type Props = {
  value: DatePreset;
  onChange: (next: DatePreset) => void;
};

export function DateRangePresetSelect(props: Props) {
  const { value, onChange } = props;

  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] font-medium text-zinc-900">Date range</div>
      <select
        className="h-8 rounded-xl border border-zinc-200 bg-white px-3 text-[10px] text-zinc-900 outline-none focus:border-zinc-400"
        value={value}
        onChange={(e) => onChange(e.target.value as DatePreset)}
      >
        <option value="7d">Past 7 days (Super fast — recent form)</option>
        <option value="30d">Past 30 days (Fast — current repertoire)</option>
        <option value="6m">Past 6 months (Balanced — reliable prep)</option>
        <option value="18m">Past 18 months (Stable — long-term tendencies)</option>
        <option value="all">All time (Deep history — maximum sample)</option>
        <option value="custom">Custom</option>
      </select>
    </div>
  );
}
