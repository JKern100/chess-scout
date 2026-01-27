"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, RefreshCw, Trash2, Play, Loader2 } from "lucide-react";
import { SYNTHETIC_STYLE_PRESETS, RATING_TIERS, type SyntheticStylePreset, type RatingTier } from "@/config/syntheticStylePresets";

type SyntheticOpponent = {
  id: string;
  name: string;
  stylePreset: SyntheticStylePreset;
  openingEco: string | null;
  openingName: string;
  openingFen: string;
  ratingTier: RatingTier;
  syncStatus: "pending" | "syncing" | "complete" | "error";
  syncError?: string | null;
  gamesFetched: number;
  gamesScored: number;
  styleMarkers?: any;
  createdAt: string;
};

type Props = {
  opponent: SyntheticOpponent;
  onArchive: (id: string) => void;
  onResync: (id: string) => void;
};

export function SyntheticOpponentCard({ opponent, onArchive, onResync }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(opponent.syncStatus === "syncing");

  const preset = SYNTHETIC_STYLE_PRESETS[opponent.stylePreset];
  const ratingConfig = RATING_TIERS[opponent.ratingTier];

  const handleResync = async () => {
    setSyncing(true);
    try {
      await onResync(opponent.id);
    } finally {
      setSyncing(false);
    }
  };

  const handlePlay = () => {
    // Store the synthetic opponent info for the play page
    try {
      window.localStorage.setItem(
        "chessscout.syntheticOpponent",
        JSON.stringify({
          id: opponent.id,
          name: opponent.name,
          stylePreset: opponent.stylePreset,
          openingFen: opponent.openingFen,
          styleMarkers: opponent.styleMarkers,
        })
      );
    } catch {
      // ignore
    }
    router.push("/play?mode=simulation&synthetic=true");
  };

  const isReady = opponent.syncStatus === "complete" && opponent.gamesScored > 0;
  const isSyncing = opponent.syncStatus === "syncing" || syncing;
  const hasError = opponent.syncStatus === "error";

  return (
    <div className="relative rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-xl"
            style={{ backgroundColor: `${preset.color}15` }}
          >
            {preset.icon}
          </div>
          <div>
            <h3 className="font-semibold text-zinc-900">{opponent.name}</h3>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{opponent.openingEco}</span>
              <span>·</span>
              <span>{ratingConfig.label}</span>
            </div>
          </div>
        </div>

        {/* Menu */}
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleResync();
                  }}
                  disabled={isSyncing}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
                  Resync Games
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onArchive(opponent.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Archive
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="mt-3">
        {isSyncing && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Loader2 className="h-3 w-3 animate-spin" />
            Syncing games from Lichess Explorer...
          </div>
        )}

        {hasError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            Sync failed: {opponent.syncError || "Unknown error"}
          </div>
        )}

        {opponent.syncStatus === "pending" && !isSyncing && (
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            Waiting to sync...
          </div>
        )}

        {isReady && (
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-500">
              {opponent.gamesScored} games · Ready to play
            </div>
            <button
              type="button"
              onClick={handlePlay}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <Play className="h-3 w-3" />
              Play
            </button>
          </div>
        )}
      </div>

      {/* Style Badge */}
      <div className="mt-3 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${preset.color}15`,
            color: preset.color,
          }}
        >
          {preset.icon} {preset.label}
        </span>
        <span className="text-xs text-zinc-400">
          Simulated opponent
        </span>
      </div>
    </div>
  );
}
