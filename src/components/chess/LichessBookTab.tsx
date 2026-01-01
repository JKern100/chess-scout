"use client";

import type { LichessExplorerMove, ExplorerSource } from "@/lib/lichess/explorer";
import { sanToFigurine } from "@/components/chess/FigurineIcon";

type Props = {
  moves: LichessExplorerMove[] | null;
  busy: boolean;
  error: string | null;
  onRetry?: () => void;
  onMoveClick?: (san: string, uci: string) => void;
  source: ExplorerSource;
  onSourceChange: (source: ExplorerSource) => void;
  showArrows: boolean;
  onShowArrowsChange: (show: boolean) => void;
  isWhiteToMove: boolean;
};

function formatGameCount(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-[72px_68px_1fr] items-center gap-2 rounded-lg px-1 py-0.5">
      <div className="h-3 w-10 animate-pulse rounded bg-zinc-200" />
      <div className="h-3 w-12 animate-pulse rounded bg-zinc-200" />
      <div className="h-3 w-full animate-pulse rounded-full bg-zinc-200" />
    </div>
  );
}

export function LichessBookTab(props: Props) {
  const { moves, busy, error, onRetry, onMoveClick, source, onSourceChange, showArrows, onShowArrowsChange, isWhiteToMove } = props;

  return (
    <div className="grid min-w-0 gap-2">
      {/* Compact header with controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              source === "masters"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
            onClick={() => onSourceChange("masters")}
          >
            Masters
          </button>
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              source === "lichess"
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
            onClick={() => onSourceChange("lichess")}
          >
            Lichess
          </button>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1 text-[10px] text-zinc-600">
          <input
            type="checkbox"
            checked={showArrows}
            onChange={(e) => onShowArrowsChange(e.target.checked)}
            className="h-3 w-3 rounded border-zinc-300"
          />
          Arrows
        </label>
      </div>

      {/* Source description */}
      <div className="text-[10px] text-zinc-500">
        {source === "masters" ? "Master games (2200+ FIDE)" : "Blitz/Rapid/Classical • Ratings 1600+"}
      </div>

      {error ? (
        <div className="grid gap-2">
          <div className="text-[10px] text-rose-700">{error}</div>
          {onRetry ? (
            <button
              type="button"
              className="w-fit rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={onRetry}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[360px] gap-2">
          <div className="grid grid-cols-[72px_68px_1fr] gap-2 text-[10px] font-medium text-zinc-500">
            <div>Move</div>
            <div>Games</div>
            <div>Results</div>
          </div>

          {busy ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : moves?.length ? (
            <>
              {moves.slice(0, 12).map((m) => {
                const total = Math.max(1, m.total);
                const winPct = (m.white / total) * 100;
                const drawPct = (m.draws / total) * 100;
                const lossPct = (m.black / total) * 100;

                return (
                  <div
                    key={m.san}
                    className="grid cursor-pointer grid-cols-[72px_68px_1fr] items-center gap-2 rounded-lg px-1 py-0.5 transition-colors hover:bg-zinc-100"
                    onClick={() => onMoveClick?.(m.san, m.uci)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onMoveClick?.(m.san, m.uci);
                      }
                    }}
                  >
                    <div className="min-w-0 truncate text-xs font-medium text-zinc-900">{sanToFigurine(m.san, isWhiteToMove)}</div>
                    <div className="text-[10px] font-medium text-zinc-700">{formatGameCount(m.total)}</div>
                    <div className="h-3 overflow-hidden rounded-full border border-zinc-200 bg-zinc-100">
                      <div className="flex h-full w-full">
                        <div className="h-full bg-emerald-500" style={{ width: `${winPct}%` }} />
                        <div className="h-full bg-neutral-300" style={{ width: `${drawPct}%` }} />
                        <div className="h-full bg-rose-500" style={{ width: `${lossPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="text-[10px] text-zinc-500">Click a move to play it. Showing top 12.</div>
            </>
          ) : (
            <div className="text-[10px] text-zinc-600">No explorer data for this position.</div>
          )}
        </div>
      </div>
    </div>
  );
}
