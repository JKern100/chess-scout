"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, RefreshCw, Trash2, Play, Loader2, BookOpen, Info, X } from "lucide-react";
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
  onShowSavedLines?: (id: string) => void;
};

export function SyntheticOpponentCard({ opponent, onArchive, onResync, onShowSavedLines }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(opponent.syncStatus === "syncing");
  const [showColorModal, setShowColorModal] = useState(false);

  const preset = SYNTHETIC_STYLE_PRESETS[opponent.stylePreset];
  const ratingConfig = RATING_TIERS[opponent.ratingTier];

  // Determine if the opening is typically a "defense" (played by Black) or "attack/opening" (played by White)
  const openingColorInfo = useMemo(() => {
    const name = opponent.openingName.toLowerCase();
    const isDefense = name.includes("defense") || name.includes("defence") || 
                      name.includes("sicilian") || name.includes("french") || 
                      name.includes("caro-kann") || name.includes("dutch") ||
                      name.includes("scandinavian") || name.includes("king's indian") ||
                      name.includes("nimzo") || name.includes("grunfeld") ||
                      name.includes("benoni") || name.includes("pirc") ||
                      name.includes("alekhine") || name.includes("petroff");
    
    // Check FEN to see whose move it is (helpful for positions)
    const fenParts = opponent.openingFen.split(" ");
    const sideToMove = fenParts[1] === "w" ? "White" : "Black";
    
    return {
      isDefense,
      typicalColor: isDefense ? "Black" : "White",
      sideToMove,
    };
  }, [opponent.openingName, opponent.openingFen]);

  const handleResync = async () => {
    setSyncing(true);
    try {
      await onResync(opponent.id);
    } finally {
      setSyncing(false);
    }
  };

  const handlePlayClick = () => {
    setShowColorModal(true);
  };

  const handlePlayWithColor = (playerColor: "white" | "black") => {
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
          playerColor,
        })
      );
    } catch {
      // ignore
    }
    setShowColorModal(false);
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
              onClick={handlePlayClick}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
            >
              <Play className="h-3 w-3" />
              Play
            </button>
          </div>
        )}
      </div>

      {/* Show Saved Lines Button */}
      {onShowSavedLines && (
        <button
          type="button"
          onClick={() => onShowSavedLines(opponent.id)}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <BookOpen className="h-4 w-4 text-zinc-400" />
          <span>Show Saved Lines</span>
        </button>
      )}

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

      {/* Color Selection Modal */}
      {showColorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Info className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold text-zinc-900">Choose Your Color</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowColorModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {/* Opening Info */}
              <div className="rounded-xl bg-zinc-50 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{preset.icon}</span>
                  <div>
                    <div className="font-semibold text-zinc-900">{opponent.openingName}</div>
                    <div className="text-xs text-zinc-500">{opponent.openingEco} · {preset.label} style</div>
                  </div>
                </div>
              </div>

              {/* Color Explanation */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">
                      The <span className="font-bold">{opponent.openingName}</span> is typically played by <span className="font-bold">{openingColorInfo.typicalColor}</span>.
                    </p>
                  </div>
                </div>
              </div>

              {/* Color Options */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => handlePlayWithColor("white")}
                  className="w-full rounded-xl border-2 border-zinc-200 p-4 text-left transition-all hover:border-zinc-400 hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white border border-zinc-200 shadow-sm">
                      <span className="text-xl">♔</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-zinc-900">Play as White</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {openingColorInfo.isDefense ? (
                          <>You&apos;ll see typical <span className="font-medium">responses to this defense</span>. Practice attacking moves against the {opponent.openingName}.</>
                        ) : (
                          <>You&apos;ll play the <span className="font-medium">main opening moves</span>. The opponent will show you {preset.label.toLowerCase()} responses.</>
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handlePlayWithColor("black")}
                  className="w-full rounded-xl border-2 border-zinc-200 p-4 text-left transition-all hover:border-zinc-400 hover:bg-zinc-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700 shadow-sm">
                      <span className="text-xl text-white">♚</span>
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-zinc-900">Play as Black</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {openingColorInfo.isDefense ? (
                          <>You&apos;ll play the <span className="font-medium">defense moves</span>. The opponent will show you {preset.label.toLowerCase()} lines within the {opponent.openingName}.</>
                        ) : (
                          <>You&apos;ll see <span className="font-medium">typical attacking moves</span> from White. Practice defending against the {opponent.openingName}.</>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
