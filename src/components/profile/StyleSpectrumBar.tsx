"use client";

import { useEffect, useMemo, useState } from "react";

export function StyleSpectrumBar(props: {
  title: string;
  leftLabel: string;
  rightLabel: string;
  positionPct: number;
  animate?: boolean;
}) {
  const pos = useMemo(() => {
    const n = Number(props.positionPct);
    if (!Number.isFinite(n)) return 50;
    return Math.max(0, Math.min(100, n));
  }, [props.positionPct]);

  const [animPos, setAnimPos] = useState<number>(pos);

  useEffect(() => {
    if (!props.animate) {
      setAnimPos(pos);
      return;
    }

    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      const jitter = (Math.random() - 0.5) * 50;
      const next = Math.max(0, Math.min(100, pos + jitter));
      setAnimPos(next);
    }, 220);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pos, props.animate]);

  return (
    <div className="grid gap-1">
      <div className="text-xs font-semibold text-neutral-800">{props.title}</div>
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-neutral-200" />

        <div
          className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-neutral-500"
          style={{ left: "50%" }}
          title="Global benchmark"
        />

        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-500 shadow transition-[left] duration-200 ease-in-out"
          style={{ left: `${props.animate ? animPos : pos}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[10px] text-neutral-500">
        <div className="truncate">{props.leftLabel}</div>
        <div className="truncate text-right">{props.rightLabel}</div>
      </div>
    </div>
  );
}
